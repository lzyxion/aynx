import { SvelteMap } from "svelte/reactivity";
import type { TranscriptPicture } from "$lib/context";
import type { DocImageState } from "$lib/doc-images.svelte";
import { DOC_IMAGE_MAX_BYTES } from "$lib/doc-images";
import { pictureKey } from "$lib/transcript";
import { formatSize, isSessionGone } from "$lib/sftp-browser";
import { stripReason } from "$lib/error-reason";
import { t } from "$lib/i18n/i18n.svelte.js";

/**
 * **사람 말에 바로 실린 그림의 캐시**(2026-10-24 — AI 타일 대화 면) — Claude 붙여넣기 · 끌어 놓은 파일의 base64 · Codex 데이터 URL 은
 * 경로가 없어 `DocImageCache`(백엔드 + 경로)로는 못 읽는다. 쪽은 자리(`TranscriptPicture`)만 싣고, 바이트는 부르는 쪽이 준 `fetch`
 * (로컬 `agent_conversation_image` · 원격 `…_remote` — 파일은 Rust 가 id 로 색인에서만 찾는다)로 한 장씩 받아 `blob:` 으로 그린다
 * (`DocImageCache` 와 같은 상한 · CSP `img-src blob:`). 대화 열쇠(`conv`)가 바뀌면 전부 거둔다 — 자리는 그 파일의 바이트 위치다.
 * 대화 파일은 끝에 덧붙기만 하므로 한 번 읽은 자리는 다시 읽지 않는다.
 */
export class ConvImageCache {
  #states = new SvelteMap<string, DocImageState>();
  #conv: string | null = null;
  #fetch: ((p: TranscriptPicture) => Promise<ArrayBuffer>) | null = null;
  /** 대화가 바뀔 때마다 하나씩 — 늦게 온 옛 대화의 답을 버린다 */
  #gen = 0;

  state(p: TranscriptPicture): DocImageState {
    return this.#states.get(pictureKey(p)) ?? { status: "loading" };
  }

  /** 우클릭 메뉴의 원본 — 그 자리를 다시 읽는다(화면의 `blob:` 은 언제든 거둔다) */
  source(p: TranscriptPicture): { mime: string; read: () => Promise<ArrayBuffer> } | null {
    const fetch = this.#fetch;
    return fetch ? { mime: p.mime, read: () => fetch(p) } : null;
  }

  broken(p: TranscriptPicture): void {
    const k = pictureKey(p);
    this.#drop(k);
    this.#states.set(k, { status: "fail", why: t("files.doc.md.image.broken") });
  }

  /** 지금 보이는 사람 말의 그림 자리들 — 새 것은 읽고 사라진 것은 거둔다 */
  sync(pics: readonly TranscriptPicture[], conv: string | null, fetch: (p: TranscriptPicture) => Promise<ArrayBuffer>): void {
    if (conv !== this.#conv) {
      this.dispose();
      this.#conv = conv;
    }
    this.#fetch = fetch;
    const want = new Map(pics.map((p) => [pictureKey(p), p]));
    for (const k of [...this.#states.keys()]) if (!want.has(k)) this.#forget(k);
    if (conv === null) return;
    for (const [k, p] of want) if (!this.#states.has(k)) void this.#load(k, p, fetch);
  }

  dispose(): void {
    for (const k of [...this.#states.keys()]) this.#forget(k);
    this.#gen++;
    this.#conv = null;
  }

  #drop(k: string): void {
    const s = this.#states.get(k);
    if (s?.status === "ok") URL.revokeObjectURL(s.url);
  }

  #forget(k: string): void {
    this.#drop(k);
    this.#states.delete(k);
  }

  async #load(k: string, p: TranscriptPicture, fetch: (p: TranscriptPicture) => Promise<ArrayBuffer>): Promise<void> {
    const gen = this.#gen;
    this.#states.set(k, { status: "loading" });
    const live = () => gen === this.#gen && this.#states.get(k)?.status === "loading";
    try {
      const bytes = await fetch(p);
      if (!live()) return;
      if (bytes.byteLength > DOC_IMAGE_MAX_BYTES) {
        const why = t("files.doc.md.image.toolarge", { size: formatSize(bytes.byteLength), limit: formatSize(DOC_IMAGE_MAX_BYTES) });
        this.#states.set(k, { status: "fail", why });
        return;
      }
      this.#states.set(k, { status: "ok", url: URL.createObjectURL(new Blob([bytes], { type: p.mime })) });
    } catch (e) {
      if (!live()) return;
      const message = e instanceof Error ? e.message : String(e);
      const why = isSessionGone(message) ? t("files.doc.md.image.offline") : t("files.doc.md.image.error", { message: stripReason(message) });
      this.#states.set(k, { status: "fail", why });
    }
  }
}
