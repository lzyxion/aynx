// **사용자 아바타(옛 사용자 앱 아이콘)** — 자르기 모달 상태 · 넣기 · 다시 자르기 · 이름 · 지우기 · 지정 (docs/log/2026-10-22-custom-app-icon.md ·
// docs/log/2026-10-31-avatars.md). 목록 사본 자체는 `$lib/avatars.svelte` 의 `avatarLibrary` 하나다(그리는 자리 모두가 읽는다).
//
// 그림 파일(`<설정 루트>/app-icons/user-<12hex>.png`)과 이름표(`names.json`)를 만들고 지우는 것은 Rust(`app_icon.rs` · `app_icon/user.rs`)이고,
// 여기는 설정 › 테마 › 아바타 화면(`settings/AvatarsSection.svelte`)과 자르기 모달(`dialogs/AppIconCropDialog.svelte`)이 나눠 쓰는 화면 상태다.
// 원본 파일은 `<input type=file>` 로 받아 이 창의 object URL 로만 그린다 — 경로를 Rust 에 넘기지 않고 asset 프로토콜 범위도
// 넓히지 않는다. 고른 영역을 캔버스로 PNG 로 만들어 바이트만 넘기면 Rust 가 다시 디코드 · 검증 · 256px · 둥근 마스크를 한다.
//
// 규칙:
// - **넣기 · 지우기 · 이름 바꾸기는 곧바로 파일 작업**이다(미저장 변경이 아니다). **지정**(앱 아이콘 · Claude Code · Codex 에 어느
//   그림을 쓰나)은 미저장 변경이다 — 곧바로 미리 보이고 설정 [저장] 이 파일에 쓴다 · [취소] 가 되돌린다(`setAppIcon` · `setAiAvatar`).
// - 넣기는 고르지 않는다 — 단, 지정 줄의 [바꾸기] 팝오버에서 넣은 그림은 그 자리에 지정한다(`assignTo` — 역시 미저장 변경).
// - 지울 때 그 그림을 지정한 칸(앱 아이콘 · AI CLI)은 기본으로 돌린다(미저장 변경). 아티스트(`orchestration-artists.toml` 의
//   `user:<12hex>`)와 테마 프로필은 값을 그대로 두고 그릴 때 기본으로 접힌다 — 확인 상자가 그 자리를 모두 나열한다([`avatarUsages`]).
// - **다시 자르기** = 원본이 없으므로 지금 그림(256px)을 자르기 모달에 다시 넣어 **새 그림으로 바꾼다**: 새 id 넣기 → 이름 · 지정 옮기기
//   (설정 칸은 미저장 변경 · 아티스트는 곧바로 `orchestration_artist_set`) → 옛 그림 지우기. 테마 프로필의 값은 옮기지 않는다(지우기와 같다).
//   설정을 [취소] 하면 지정 칸은 옛 id 로 돌아가 기본으로 접힌다 — 지우기와 같은 대가다.
// - 원격 웹 클라이언트는 목록을 **읽기만** 한다(`deny.rs` 허용 — 원격 화면에도 아바타가 보이게) — 화면이 관리 단추를 숨긴다.
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

/** Rust `app_icon_list` · `app_icon_add` 의 한 줄 — id · 96px 썸네일 data URL · 이름 · 넣은 때(`avatars.svelte` 의 것과 같다) */
export type UserAppIcon = UserAvatar;

/** 쌓아 둘 수 있는 수 — Rust `app_icon/user.rs` 의 `MAX_ICONS` 와 같다(넘으면 그쪽이 거절한다 — 여기는 [아바타 추가] 를 흐리게) */
export const MAX_USER_APP_ICONS = 24;
/** 이름 길이 상한 — Rust `app_icon/user.rs` 의 `NAME_MAX` 와 같다(넘으면 그쪽이 거절한다) */
export const AVATAR_NAME_MAX = 32;
/** 고를 수 있는 원본 파일 크기 상한 — 디코드는 이 창에서 한다(웹뷰 메모리) */
const MAX_SOURCE_BYTES = 50 * 1024 * 1024;

/** 그림을 지정하는 자리 — 앱 아이콘 · AI CLI 둘(아티스트는 오케스트레이션 탭의 아티스트 화면이 쥔다) */
export type AvatarSlot = "app" | keyof typeof DEFAULT_AI_AVATARS;

export const userAppIcons = $state({
  /** 화면 아래 한 줄 — 넣기 · 지우기 · 이름 · 읽기 실패 */
  error: null as string | null,
});

/** 목록을 다시 읽는다 — 화면이 붙을 때마다(다른 창에서 넣은 것도 보이게). 원격도 읽는다(허용 표) */
export async function loadUserAppIcons(): Promise<void> {
  try {
    await loadAvatars();
  } catch (e) {
    userAppIcons.error = t("settings.theme.app_icon.error.list", { error: stripReason(String(e)) });
  }
}

/** 사용자 아이콘 하나를 앱 아이콘으로 고른다 — 스플래시 사본에 썸네일을 적고 `setAppIcon`(곧바로 걸고 미저장 변경으로) */
export function pickUserAppIcon(icon: UserAppIcon): void {
  rememberSplashUserIcon(icon.id, icon.src);
  setAppIcon(icon.id);
}

/** 그 자리에 지금 **실제로 그려지는** 그림 id — 지운 그림 · 모르는 값은 기본으로 접는다 */
export function slotAvatarId(slot: AvatarSlot): string {
  if (slot !== "app") return cliAvatarId(slot);
  return avatarSrc(settings.appIcon) !== null ? (avatarId(settings.appIcon) ?? DEFAULT_APP_ICON) : DEFAULT_APP_ICON;
}

/** 그 자리에 그림을 지정한다(미저장 변경 — 머리말). 사용자 그림이면 앱 아이콘은 스플래시 사본도 적는다 */
export function assignAvatar(slot: AvatarSlot, id: string): void {
  if (slot !== "app") {
    setAiAvatar(slot, id);
    return;
  }
  const user = avatarLibrary.list.find((a) => a.id === id);
  if (user) pickUserAppIcon(user);
  else setAppIcon(id);
}

/** 아티스트 아이콘 값(`user:<12hex>` · 내장 낱말)이 이 라이브러리 id 를 가리키는가 */
function artistUses(a: Pick<ArtistProfile, "icon">, id: string): boolean {
  return avatarId(a.icon) === id;
}

/** 이 그림을 지정한 자리 — 지우기 확인 · 카드 칩이 읽는다. 아티스트 목록은 Tauri `orchestration_artist_list`(실패면 빈 목록) */
export interface AvatarUsage {
  app: boolean;
  claude: boolean;
  codex: boolean;
  /** 이 그림을 아이콘으로 쓰는 아티스트 이름 */
  artists: string[];
  /** 이 그림을 앱 아이콘으로 담은 테마 프로필 수 */
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

/** 지우기 확인의 점 목록 — "어디 → 무엇으로 돌아가나" */
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

/**
 * 사용자 아바타 하나를 지운다(확인 뒤). 확인 상자가 그 그림을 지정한 곳을 모두 나열한다. 앱 아이콘 · AI CLI 아바타가 그것이면 기본으로
 * 돌린다(미저장 변경 — Rust 도 앱 아이콘의 메모리 값을 돌린다). 아티스트 · 테마 프로필은 값을 두고 그릴 때 접힌다.
 */
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
  // 파일은 이미 없다 — 설정 값을 기본으로 돌리는 것은 미저장 변경으로 둔다(다른 고르기와 같은 규칙). [취소] 로 남은 없는 id 는
  // Rust 가 기본 그림으로 접고(`app_icon::resolve`) 부팅 때도 접힌다 — 그대로 둬도 안전하다.
  if (settings.appIcon === id) setAppIcon(DEFAULT_APP_ICON);
  if (settings.current.ai.avatar_claude === id) setAiAvatar("claude", "");
  if (settings.current.ai.avatar_codex === id) setAiAvatar("codex", "");
}

/** 이름을 바꾼다(빈 글자 = 이름 걷기 → "사용자 N") — 곧바로 파일. 실패는 화면 아래 한 줄 */
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
  /** 원본의 URL — object URL(넣기 · 닫을 때 걷는다) 또는 data URL(다시 자르기) */
  url: null as string | null,
  /** 원본의 화소 크기(EXIF 방향 반영 — `naturalWidth`) */
  width: 0,
  height: 0,
  busy: false,
  error: null as string | null,
  /** 이름 칸(선택 — 비우면 "사용자 N") */
  name: "",
  /** 다시 자르기면 바꿀 옛 그림 id */
  replace: null as string | null,
  /** [바꾸기] 팝오버에서 넣었으면 넣은 그림을 지정할 자리 */
  assignTo: null as AvatarSlot | null,
});

export function appIconCropVisible(): boolean {
  return appIconCrop.open;
}

/** 그림 URL 을 풀어 모달을 연다 — 실패면 화면 아래 한 줄 */
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

/** 고른 파일을 읽어 자르기 모달을 연다 — 크기 · 형식이 틀리면 화면 아래 한 줄로 알린다 */
export async function startAppIconCrop(file: File, assignTo: AvatarSlot | null = null): Promise<void> {
  userAppIcons.error = null;
  if (file.size > MAX_SOURCE_BYTES) {
    userAppIcons.error = t("settings.theme.app_icon.error.tooBig", { mb: String(MAX_SOURCE_BYTES / (1024 * 1024)) });
    return;
  }
  await openCrop(URL.createObjectURL(file), { name: "", replace: null, assignTo });
}

/** 사용자 그림을 다시 자른다 — 지금 그림(256px 원본 data URL)을 모달에 넣는다(머리말 "다시 자르기") */
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

/** 다시 자른 새 그림으로 옛 그림을 바꾼다 — 지정(설정 칸 · 아티스트)을 옮기고 옛 파일을 지운다(머리말) */
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

/** 고른 영역을 PNG 로 만들어 라이브러리에 넣는다(다시 자르기면 옛 그림을 바꾼다). 실패는 모달 안 한 줄(모달은 열린 채) */
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
    if (replace) await loadAvatars(); // 바꾼 그림은 목록의 순서 · 이름이 바뀐다 — 다시 읽는다
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
