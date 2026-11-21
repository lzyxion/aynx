/**
 * 대화 면 입력 칸의 첨부 칩 상태 — 열쇠(AI 타일 = 타일 id · 사이드 채팅 = `side:<채팅 id>`)마다 목록 하나, 저장하지 않는다.
 * 경로가 차기 전에는 보내기를 막는다. `blob:` 은 빼기 · 비우기에서 거둔다.
 */
import { showNotice } from "$lib/app/notice";
import { stripReason } from "$lib/error-reason";
import { t } from "$lib/i18n/i18n.svelte.js";
import {
  COMPOSER_ATTACH_MAX,
  isImageName,
  type SentPic,
  removeAttachment,
  settleAttachment,
  type ComposerAttachment,
} from "$lib/pane/composer-attachments";

let byKey = $state<Record<string, ComposerAttachment[]>>({});
let seq = 0;

const NONE: readonly ComposerAttachment[] = [];

export function composerAttachmentsOf(key: string): readonly ComposerAttachment[] {
  return byKey[key] ?? NONE;
}

function revoke(a: ComposerAttachment): void {
  if (a.url) URL.revokeObjectURL(a.url);
}

function setList(key: string, list: ComposerAttachment[]): void {
  if (list.length === 0) {
    if (key in byKey) delete byKey[key];
  } else byKey[key] = list;
}

/** `stage` 는 받은 차례대로 경로를 돌려준다. `still` 이 거짓이면(그 사이 타일이 닫히거나 재접속했다) 칩을 걷는다 */
export async function stageComposerAttachments(
  key: string,
  items: readonly { name: string; file?: File }[],
  stage: () => Promise<readonly string[]>,
  still: () => boolean = () => true,
): Promise<void> {
  if (items.length === 0) return;
  if (composerAttachmentsOf(key).length + items.length > COMPOSER_ATTACH_MAX) {
    showNotice(t("pane.flip.composer.tooMany", { n: COMPOSER_ATTACH_MAX }));
    return;
  }
  const made: ComposerAttachment[] = items.map((it) => ({
    id: ++seq,
    name: it.name,
    path: null,
    url: it.file && isImageName(it.name) ? URL.createObjectURL(it.file) : null,
  }));
  setList(key, [...composerAttachmentsOf(key), ...made]);
  const drop = () => {
    const ids = new Set(made.map((a) => a.id));
    for (const a of made) revoke(a);
    setList(key, composerAttachmentsOf(key).filter((a) => !ids.has(a.id)));
  };
  try {
    const paths = await stage();
    if (!still() || paths.length !== made.length) {
      drop();
      showNotice(t("pane.drop.attach.notready"));
      return;
    }
    let list = [...composerAttachmentsOf(key)];
    made.forEach((a, i) => (list = settleAttachment(list, a.id, paths[i])));
    setList(key, list);
  } catch (e) {
    drop();
    showNotice(t("pane.drop.attach.failed", { message: stripReason(e instanceof Error ? e.message : String(e)) }));
  }
}

export function removeComposerAttachment(key: string, id: number): void {
  const list = composerAttachmentsOf(key);
  const gone = list.find((a) => a.id === id);
  if (gone) revoke(gone);
  setList(key, removeAttachment(list, id));
}

/** 그림 칩의 `blob:` 은 거두지 않고 돌려준다 — 막 보낸 말풍선이 그린다(거두는 것은 넘겨받은 쪽 [`revokeSentPics`]) */
export function takeComposerPictures(key: string): SentPic[] {
  const out: SentPic[] = [];
  for (const a of composerAttachmentsOf(key)) {
    if (a.url && isImageName(a.name)) out.push({ name: a.name, url: a.url });
    else revoke(a);
  }
  setList(key, []);
  return out;
}

export function revokeSentPics(pics: readonly SentPic[] | undefined): void {
  for (const p of pics ?? []) URL.revokeObjectURL(p.url);
}

export function clearComposerAttachments(key: string): void {
  for (const a of composerAttachmentsOf(key)) revoke(a);
  setList(key, []);
}
