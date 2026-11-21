import { SvelteMap } from "svelte/reactivity";
import type { FsBackend } from "$lib/fs-backend";
import { DOC_IMAGE_MAX_BYTES, docImagePlan } from "$lib/doc-images";
import { formatSize, isSessionGone } from "$lib/sftp-browser";
import { stripReason } from "$lib/error-reason";
import { t } from "$lib/i18n/i18n.svelte.js";

/**
 * 문서 타일의 그림 캐시 — `readPreview` 바이트 → `Blob` URL. 자산 프로토콜(`asset://`)의 허용 범위는 넓히지 않는다(아무 경로나 웹뷰가 읽게 되면 안 된다).
 * CSP `img-src` 의 `blob:` 에 기댄다(`src-tauri/tauri.conf.json` — 빼면 문서 그림이 전부 깨진다).
 */

export type DocImageState = { status: "loading" } | { status: "ok"; url: string } | { status: "fail"; why: string };

interface Ctx {
  backend: FsBackend;
  docPath: string;
  remote: boolean;
  gen: string;
  noNetwork?: boolean;
}

interface Meta {
  /** `크기:시각` — 못 읽었으면 `null` */
  stamp: string | null;
  /** 늦게 온 옛 답을 버린다 */
  ticket: number;
}

const LOADING: DocImageState = { status: "loading" };

export class DocImageCache {
  #states = new SvelteMap<string, DocImageState>();
  #meta = new Map<string, Meta>();
  #ctx = $state.raw<Ctx | null>(null);
  #seq = 0;

  #keyOf(ctx: Ctx, src: string): { key: string; path: string; mime: string } | { skip: "scheme" | "path" | "ext" } {
    const plan = docImagePlan(ctx.docPath, src, ctx.remote, ctx.noNetwork);
    if (plan.kind === "skip") return { skip: plan.why };
    return { key: `${ctx.backend.key}\u0000${plan.path}`, path: plan.path, mime: plan.mime };
  }

  state(src: string): DocImageState {
    const ctx = this.#ctx;
    if (!ctx) return LOADING;
    const k = this.#keyOf(ctx, src);
    if ("skip" in k) {
      if (k.skip === "scheme") return { status: "fail", why: t("files.doc.md.image.external", { href: src }) };
      if (k.skip === "ext") return { status: "fail", why: t("files.doc.md.image.format", { href: src }) };
      return { status: "fail", why: t("files.doc.md.image.path", { href: src }) };
    }
    if (!ctx.backend.online) return { status: "fail", why: t("files.doc.md.image.offline") };
    return this.#states.get(k.key) ?? LOADING;
  }

  /** 화면의 `blob:` 은 이 캐시가 언제든 거두므로 건네지 않고 원본을 다시 읽는 손잡이를 준다 */
  source(src: string): { path: string; mime: string; read: () => Promise<ArrayBuffer> } | null {
    const ctx = this.#ctx;
    if (!ctx) return null;
    const k = this.#keyOf(ctx, src);
    if ("skip" in k) return null;
    const backend = ctx.backend;
    return { path: k.path, mime: k.mime, read: () => backend.readPreview(k.path) };
  }

  broken(src: string): void {
    const ctx = this.#ctx;
    if (!ctx) return;
    const k = this.#keyOf(ctx, src);
    if ("skip" in k) return;
    this.#drop(k.key, false);
    this.#states.set(k.key, { status: "fail", why: t("files.doc.md.image.broken") });
  }

  sync(srcs: readonly string[], ctx: Ctx): void {
    const prevGen = this.#ctx?.gen;
    this.#ctx = ctx;
    const want = new Map<string, { path: string; mime: string }>();
    for (const src of srcs) {
      const k = this.#keyOf(ctx, src);
      if (!("skip" in k)) want.set(k.key, { path: k.path, mime: k.mime });
    }
    for (const key of [...this.#states.keys()]) if (!want.has(key)) this.#drop(key, true);
    if (!ctx.backend.online) return;
    for (const [key, w] of want) {
      const s = this.#states.get(key);
      if (!s) void this.#load(key, w.path, w.mime, ctx.backend);
      else if (prevGen !== undefined && prevGen !== ctx.gen && s.status !== "loading") void this.#recheck(key, w.path, w.mime, ctx.backend);
    }
  }

  dispose(): void {
    for (const key of [...this.#states.keys()]) this.#drop(key, true);
    this.#ctx = null;
  }

  #drop(key: string, forget: boolean): void {
    const s = this.#states.get(key);
    if (s?.status === "ok") URL.revokeObjectURL(s.url);
    if (forget) {
      this.#states.delete(key);
      this.#meta.delete(key);
    }
  }

  async #recheck(key: string, path: string, mime: string, backend: FsBackend): Promise<void> {
    const meta = this.#meta.get(key);
    if (!meta) return;
    const ticket = meta.ticket;
    try {
      const st = await backend.stat(path);
      if (this.#meta.get(key)?.ticket !== ticket) return;
      if (`${st.size}:${st.mtime}` === meta.stamp) return;
    } catch {
      // 다시 읽어 그 까닭을 띄운다
    }
    if (this.#meta.get(key)?.ticket !== ticket) return;
    await this.#load(key, path, mime, backend);
  }

  async #load(key: string, path: string, mime: string, backend: FsBackend): Promise<void> {
    const ticket = ++this.#seq;
    this.#meta.set(key, { stamp: null, ticket });
    // 다시 읽기면 옛 그림을 새 그림이 올 때까지 둔다
    if (!this.#states.has(key)) this.#states.set(key, LOADING);
    const live = () => this.#meta.get(key)?.ticket === ticket;
    const fail = (why: string) => {
      if (!live()) return;
      this.#drop(key, false);
      this.#states.set(key, { status: "fail", why });
    };
    try {
      const st = await backend.stat(path);
      if (!live()) return;
      if (st.kind === "dir") return fail(t("files.doc.md.image.notfile"));
      // 심링크의 크기는 링크 자신의 것이라 여기서 거르지 않는다 — 받은 바이트로 다시 잰다
      if (st.kind === "file" && st.size > DOC_IMAGE_MAX_BYTES) {
        return fail(t("files.doc.md.image.toolarge", { size: formatSize(st.size), limit: formatSize(DOC_IMAGE_MAX_BYTES) }));
      }
      const bytes = await backend.readPreview(path);
      if (!live()) return;
      if (bytes.byteLength > DOC_IMAGE_MAX_BYTES) {
        return fail(t("files.doc.md.image.toolarge", { size: formatSize(bytes.byteLength), limit: formatSize(DOC_IMAGE_MAX_BYTES) }));
      }
      const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
      this.#drop(key, false);
      this.#states.set(key, { status: "ok", url });
      this.#meta.set(key, { stamp: `${st.size}:${st.mtime}`, ticket });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      fail(isSessionGone(message) ? t("files.doc.md.image.offline") : t("files.doc.md.image.error", { message: stripReason(message) }));
    }
  }
}
