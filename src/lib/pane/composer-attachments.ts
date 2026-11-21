/** 대화 면 입력 칸의 첨부 칩 — 순수 층 */
import { shellQuoteAll } from "$lib/fs-drag";

export interface ComposerAttachment {
  id: number;
  name: string;
  /** `null` = 아직 준비 중(보내기를 막는다) */
  path: string | null;
  /** 미리보기 `blob:` — 없으면 파일 아이콘 */
  url: string | null;
}

/** 막 보낸 말풍선이 입력 칸 칩의 `blob:` 을 이어 쓴다 — `url` 은 넘겨받은 쪽이 거둔다(`revokeSentPics`) */
export interface SentPic {
  name: string;
  url: string;
}

/** 같은 이름은 하나씩 뺀다 */
export function filesBesidePics(files: readonly string[], pics: readonly SentPic[]): string[] {
  const left = pics.map((p) => p.name);
  return files.filter((f) => {
    const i = left.indexOf(f);
    if (i < 0) return true;
    left.splice(i, 1);
    return false;
  });
}

/** 서버 `server::side_chat::IMAGES_MAX`(그림 + 파일 합쳐)와 같은 8 */
export const COMPOSER_ATTACH_MAX = 8;
/** 서버 `IMAGE_MAX_BYTES` · `FILE_MAX_BYTES` 와 같은 10 MB */
export const SIDE_CHAT_ATTACH_MAX_BYTES = 10 * 1024 * 1024;

const IMAGE_EXT = /\.(png|jpe?g|gif|webp)$/i;

/** 서버 판정과 같은 표 */
export function isImageName(name: string): boolean {
  return IMAGE_EXT.test(name);
}

export function baseName(path: string): string {
  const parts = path.split(/[\\/]/).filter((s) => s !== "");
  return parts.length > 0 ? parts[parts.length - 1] : path;
}

export function settleAttachment(list: readonly ComposerAttachment[], id: number, path: string): ComposerAttachment[] {
  return list.map((a) => (a.id === id ? { ...a, path } : a));
}

export function removeAttachment(list: readonly ComposerAttachment[], id: number): ComposerAttachment[] {
  return list.filter((a) => a.id !== id);
}

export function attachmentsReady(list: readonly ComposerAttachment[]): boolean {
  return list.every((a) => a.path !== null);
}

export function attachmentPaths(list: readonly ComposerAttachment[]): string[] {
  return list.flatMap((a) => (a.path === null ? [] : [a.path]));
}

/**
 * 경로 하나에 붙여넣기 하나 — 보내기는 이것들을 차례로 넣고 틈을 둔 뒤 글을 친다(`TermActions.submitText`).
 * Codex 는 Windows 에서 붙여넣기를 빠른 키 묶음으로 알아봐, 여럿을 한 번에 넣거나 글을 곧바로 이으면 그림(`[Image #N]`)으로 바뀌지 않는다.
 */
export function tileAttachPastes(paths: readonly string[]): string[] {
  return paths.map((p) => `${shellQuoteAll([p])} `);
}

/** 글이 함께 있으면(표 · 웹 문서 복사) 글 붙여넣기로 둔다(빈 목록) */
export function clipboardFiles(
  dt: { getData(type: string): string; files?: ArrayLike<File> | null; items?: ArrayLike<{ kind: string; type: string; getAsFile(): File | null }> | null } | null,
): File[] {
  if (!dt) return [];
  if (dt.getData("text/plain") !== "") return [];
  const out: File[] = [];
  for (const it of Array.from(dt.items ?? [])) {
    if (it.kind !== "file") continue;
    const f = it.getAsFile();
    if (f) out.push(f);
  }
  if (out.length === 0) {
    out.push(...Array.from(dt.files ?? []));
  }
  return out;
}
