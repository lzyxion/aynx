/**
 * **대화 면 입력 칸의 첨부 칩 — 순수 층**(2026-10-24 — `pane/FlipComposer` 의 칸 위 줄). 칩 하나 = 붙인 파일 하나: 이름 · 그 CLI 가 읽을
 * 경로(`path` — 사본 · 업로드가 끝나기 전에는 `null` = 준비 중) · 미리보기(`url` — 끌어 놓거나 붙여 넣은 `File` 의 `blob:` · 경로만 있는
 * 것은 `null` = 파일 아이콘). 상태는 `pane/composer-attachments.svelte.ts`, 보내기 글은 [`tileAttachText`].
 */
import { shellQuoteAll } from "$lib/fs-drag";

export interface ComposerAttachment {
  id: number;
  name: string;
  /** CLI 가 읽을 경로 — `null` = 아직 준비 중(보내기를 막는다) */
  path: string | null;
  /** 미리보기 `blob:` — 없으면 파일 아이콘 */
  url: string | null;
}

/** 한 번에 붙이는 수 상한 — 사이드 채팅 서버 판정(`server::side_chat::IMAGES_MAX`)과 같은 8 */
export const COMPOSER_ATTACH_MAX = 8;
/** 사이드 채팅 그림 한 장의 상한 — 서버 판정과 같은 10 MB */
export const SIDE_CHAT_IMAGE_MAX_BYTES = 10 * 1024 * 1024;

const IMAGE_EXT = /\.(png|jpe?g|gif|webp)$/i;

/** 미리보기 · 사이드 채팅이 받는 그림 이름인가(png · jpg · jpeg · gif · webp — 서버 판정과 같은 표) */
export function isImageName(name: string): boolean {
  return IMAGE_EXT.test(name);
}

/** 경로의 마지막 이름(`/` · `\` 어느 쪽이든) */
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

/** 모두 준비됐나(빈 목록도 참) */
export function attachmentsReady(list: readonly ComposerAttachment[]): boolean {
  return list.every((a) => a.path !== null);
}

/** 준비된 경로들 — 칩 차례대로 */
export function attachmentPaths(list: readonly ComposerAttachment[]): string[] {
  return list.flatMap((a) => (a.path === null ? [] : [a.path]));
}

/**
 * **AI 타일 보내기의 첨부 몫** — 경로 **하나에 붙여넣기 하나**(따옴표 친 경로 + 빈칸 — 터미널 면에 파일 하나를 끌어 놓을 때 넣던 바이트,
 * `app/transfer` 의 `pasteAttachment`). 보내기는 이것들을 차례로 괄호 붙여넣기로 넣고 **틈을 둔 뒤** 칸의 글을 친다
 * (`TermActions.submitText` 의 `attach`). Codex 는 Windows 에서 붙여넣기를 빠른 키 묶음으로 알아보므로 경로 여럿을 한 번에 넣거나 글을
 * 곧바로 이어 치면 한 덩어리 글이 되어 그림(`[Image #N]`)으로 바뀌지 않는다(2026-10-24 실기). 경로가 없으면 빈 목록.
 */
export function tileAttachPastes(paths: readonly string[]): string[] {
  return paths.map((p) => `${shellQuoteAll([p])} `);
}

/**
 * 붙여넣기에서 **그림 파일**만 — 글이 함께 있으면(표 · 웹 문서 복사) 예전처럼 글 붙여넣기로 둔다(빈 목록). WebView2 는 화면 캡처를
 * `image/png` 파일 하나(`image.png`)로 준다.
 */
export function clipboardImageFiles(
  dt: { getData(type: string): string; files?: ArrayLike<File> | null; items?: ArrayLike<{ kind: string; type: string; getAsFile(): File | null }> | null } | null,
): File[] {
  if (!dt) return [];
  if (dt.getData("text/plain") !== "") return [];
  const out: File[] = [];
  for (const it of Array.from(dt.items ?? [])) {
    if (it.kind !== "file" || !it.type.startsWith("image/")) continue;
    const f = it.getAsFile();
    if (f) out.push(f);
  }
  if (out.length === 0) {
    for (const f of Array.from(dt.files ?? [])) if (f.type.startsWith("image/")) out.push(f);
  }
  return out;
}
