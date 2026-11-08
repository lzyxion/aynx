import { SvelteMap } from "svelte/reactivity";
import type { FsBackend } from "$lib/fs-backend";
import { DOC_IMAGE_MAX_BYTES, docImagePlan } from "$lib/doc-images";
import { formatSize, isSessionGone } from "$lib/sftp-browser";
import { stripReason } from "$lib/error-reason";
import { t } from "$lib/i18n/i18n.svelte.js";

/**
 * **문서 타일의 그림 읽기** — 한 문서 타일이 하나 쥐는 작은 캐시. 판정(불러올지 · 확장자 · 경로)은 `doc-images.ts` 의 순수 함수다.
 *
 * ## 어떻게 가져오나
 *
 * 파일 타일 미리 보기 패널(`browser/PreviewPanel.svelte`)과 **같은 길**이다: 백엔드의 `readPreview`(Rust 가 원시 바이트를 돌려준다 —
 * 로컬 디스크 · 원격 SFTP 같은 문)로 받아 `Blob` → `URL.createObjectURL` 로 그린다. 자산 프로토콜(`asset://`)의 허용 범위는
 * 넓히지 않는다(아무 경로나 웹뷰가 읽게 되면 안 된다). 새 Tauri 명령은 없다.
 * 이 그림들이 사는 것은 CSP `img-src` 의 `blob:` 덕이다(`src-tauri/tauri.conf.json` — 빼면 문서 그림이 전부 깨진다).
 *
 * ## 캐시
 *
 * 열쇠는 `백엔드 key + 푼 경로` — 같은 문서 안 같은 그림은 한 번만 읽는다. [`sync`] 가 지금 글의 그림 주소들을 받아 새 것은 읽고,
 * 글에서 사라진 것은 `revokeObjectURL` 로 거둔다(재연결로 백엔드 key 가 바뀌면 옛 것은 모두 사라진다). 문서의 `version`(`gen`)이
 * 바뀌면(자동 새로고침 · 저장) 이미 읽은 그림마다 `stat` 을 다시 물어 크기 · 시각이 바뀐 그림만 다시 읽는다. 타일이 사라지면
 * [`dispose`] 가 전부 거둔다.
 */

export type DocImageState = { status: "loading" } | { status: "ok"; url: string } | { status: "fail"; why: string };

interface Ctx {
  backend: FsBackend;
  docPath: string;
  remote: boolean;
  gen: string;
  /** 네트워크 경로(`\\server\…`)의 그림은 불러오지 않는다(사이드 채팅 — `docImagePlan` 의 `noNetwork`) */
  noNetwork?: boolean;
}

interface Meta {
  /** 읽은 때의 `크기:시각` — 다음 `gen` 에서 견준다. 못 읽었으면 `null` */
  stamp: string | null;
  /** 이 열쇠의 마지막 읽기 번호 — 늦게 온 옛 답을 버린다 */
  ticket: number;
}

const LOADING: DocImageState = { status: "loading" };

export class DocImageCache {
  /** 열쇠 → 상태(화면이 읽는다) */
  #states = new SvelteMap<string, DocImageState>();
  #meta = new Map<string, Meta>();
  /** 화면이 [`state`] 에서 판정에 쓰는 문맥 — 바뀌면 그림 자리들이 다시 그려진다 */
  #ctx = $state.raw<Ctx | null>(null);
  #seq = 0;

  /** 그 주소의 열쇠 · 할 일 */
  #keyOf(ctx: Ctx, src: string): { key: string; path: string; mime: string } | { skip: "scheme" | "path" | "ext" } {
    const plan = docImagePlan(ctx.docPath, src, ctx.remote, ctx.noNetwork);
    if (plan.kind === "skip") return { skip: plan.why };
    return { key: `${ctx.backend.key}\u0000${plan.path}`, path: plan.path, mime: plan.mime };
  }

  /** 그림 자리 하나의 지금 상태 — 화면(`MarkdownBlocks`)이 그릴 때 부른다 */
  state(src: string): DocImageState {
    const ctx = this.#ctx;
    if (!ctx) return LOADING;
    const k = this.#keyOf(ctx, src);
    if ("skip" in k) {
      if (k.skip === "scheme") return { status: "fail", why: t("files.doc.md.image.external", { href: src }) };
      if (k.skip === "ext") return { status: "fail", why: t("files.doc.md.image.format", { href: src }) };
      return { status: "fail", why: t("files.doc.md.image.path", { href: src }) };
    }
    // 끊겼으면 읽어 둔 그림도 대체 글자로 — 글은 남기지만(마지막으로 읽은 내용) 그림은 지금 볼 수 없는 원본의 것이다
    if (!ctx.backend.online) return { status: "fail", why: t("files.doc.md.image.offline") };
    return this.#states.get(k.key) ?? LOADING;
  }

  /**
   * 그림 우클릭 메뉴(`image-actions.ts`)가 쓸 원본 — 푼 절대 경로(원격 문서 타일이면 원격 경로) · MIME · **원본을 다시 읽는** 손잡이
   * (같은 백엔드의 `readPreview` — 화면의 `blob:` 은 이 캐시가 언제든 거두므로 건네지 않는다). 불러오지 않는 주소면 `null`
   */
  source(src: string): { path: string; mime: string; read: () => Promise<ArrayBuffer> } | null {
    const ctx = this.#ctx;
    if (!ctx) return null;
    const k = this.#keyOf(ctx, src);
    if ("skip" in k) return null;
    const backend = ctx.backend;
    return { path: k.path, mime: k.mime, read: () => backend.readPreview(k.path) };
  }

  /** `<img>` 가 바이트를 그리지 못했다(깨졌다 · 모르는 형식) */
  broken(src: string): void {
    const ctx = this.#ctx;
    if (!ctx) return;
    const k = this.#keyOf(ctx, src);
    if ("skip" in k) return;
    this.#drop(k.key, false);
    this.#states.set(k.key, { status: "fail", why: t("files.doc.md.image.broken") });
  }

  /** 지금 글의 그림 주소들 — 새 것은 읽고 사라진 것은 거둔다. `gen` 이 바뀌었으면 읽은 그림의 바뀜을 다시 묻는다 */
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
      // 끊긴 사이 실패로 남은 것도 다시 읽는다(연결이 돌아왔다)
      if (!s) void this.#load(key, w.path, w.mime, ctx.backend);
      else if (prevGen !== undefined && prevGen !== ctx.gen && s.status !== "loading") void this.#recheck(key, w.path, w.mime, ctx.backend);
    }
  }

  /** 전부 거둔다 — 타일이 사라질 때 */
  dispose(): void {
    for (const key of [...this.#states.keys()]) this.#drop(key, true);
    this.#ctx = null;
  }

  /** 열쇠의 Blob URL 을 거둔다. `forget` 이면 상태 · 읽기 번호도 지운다(늦게 온 답은 버려진다) */
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
      // 없어졌다 · 권한 — 다시 읽어 그 까닭을 띄운다
    }
    if (this.#meta.get(key)?.ticket !== ticket) return;
    await this.#load(key, path, mime, backend);
  }

  async #load(key: string, path: string, mime: string, backend: FsBackend): Promise<void> {
    const ticket = ++this.#seq;
    this.#meta.set(key, { stamp: null, ticket });
    // 다시 읽기(그림이 바뀜)면 옛 그림을 새 그림이 올 때까지 둔다 — 흔들림 없이 바꿔 낀다
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
