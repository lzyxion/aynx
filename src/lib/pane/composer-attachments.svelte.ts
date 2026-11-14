/**
 * **대화 면 입력 칸의 첨부 칩 상태**(2026-10-24) — 열쇠 하나(AI 타일 = 타일 id · 사이드 채팅 = `side:<채팅 id>`)마다 칩 목록 하나.
 * 화면 상태라 저장하지 않는다. 칩은 서자마자 보이고(이름 · 그림이면 `blob:` 미리보기) 사본 · 업로드(`stage`)가 끝나면 경로가 찬다 —
 * 그 전에는 보내기를 막는다. 실패하면 그 묶음의 칩을 걷고 알린다. `blob:` 은 빼기 · 비우기에서 거둔다.
 *
 * AI 타일은 타일 캔버스의 끌어 놓기(`app/transfer` — 대화 면이 보일 때)와 입력 칸의 그림 붙여넣기(`pane/AiFlip`)가, 사이드 채팅은
 * 그 면(`SideChatFace`)의 끌어 놓기 · 붙여넣기가 여기 넣는다. 순수 꼴은 `pane/composer-attachments.ts`.
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

/**
 * 칩을 세우고 `stage` 로 경로를 마련한다 — `stage` 는 받은 차례대로 경로를 돌려준다. `still` 이 거짓이면(그 사이 타일이 닫히거나
 * 재접속했다) 칩을 걷는다. 상한(8)을 넘는 몫은 세우지 않고 알린다.
 */
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

/** 칩 하나를 뺀다(× 단추) */
export function removeComposerAttachment(key: string, id: number): void {
  const list = composerAttachmentsOf(key);
  const gone = list.find((a) => a.id === id);
  if (gone) revoke(gone);
  setList(key, removeAttachment(list, id));
}

/**
 * **보냈다** — 칩을 모두 걷되 그림 칩의 미리보기(`blob:`)는 거두지 않고 돌려준다(막 보낸 말풍선이 그 그림을 그린다 — 거두는 것은 넘겨받은 쪽
 * [`revokeSentPics`]). 그림 밖 · 미리보기 없는 칩(파일 타일 짐)은 여기서 거둔다.
 */
export function takeComposerPictures(key: string): SentPic[] {
  const out: SentPic[] = [];
  for (const a of composerAttachmentsOf(key)) {
    if (a.url && isImageName(a.name)) out.push({ name: a.name, url: a.url });
    else revoke(a);
  }
  setList(key, []);
  return out;
}

/** 넘겨받은 그림 미리보기를 거둔다(말풍선이 기록으로 바뀌었다 · 사라졌다 · 면이 사라진다) */
export function revokeSentPics(pics: readonly SentPic[] | undefined): void {
  for (const p of pics ?? []) URL.revokeObjectURL(p.url);
}

/** 모두 걷는다 — 보낸 뒤 · 면이 사라질 때 */
export function clearComposerAttachments(key: string): void {
  for (const a of composerAttachmentsOf(key)) revoke(a);
  setList(key, []);
}
