// 아이콘 보기의 그림 칸 — 캐시 · 줄 · 동시 읽기. `$effect` 는 두지 않는다 — 붙이기(`attach`) · 다시 보기 · 거두기는 `SftpBrowser` 가 부른다.
import type { FsBackend } from "$lib/fs-backend";
import type { SftpEntry } from "$lib/sftp-browser";
import { imageMime } from "$lib/browser/preview";
import {
  fitWithin,
  thumbable,
  thumbEdge,
  thumbKey,
  thumbMaxBytes,
  THUMB_CACHE_MAX,
  THUMB_CONCURRENCY,
} from "$lib/browser/thumbs";

/** 전부 게터라 그때그때의 값이다 */
export interface FileThumbsHost {
  readonly backend: FsBackend;
  readonly offline: boolean;
  readonly isLocal: boolean;
  readonly remoteWindow: boolean;
}

interface Watched {
  entry: SftpEntry;
  visible: boolean;
}

interface Job {
  key: string;
  entry: SftpEntry;
}

/** 원본 Blob URL 은 줄인 뒤 곧바로 거둔다 — 큰 원본을 칸마다 쥐지 않는다. 움직이는 GIF 는 그래서 첫 장면만 남는다 */
async function shrink(bytes: ArrayBuffer, mime: string, edge: number): Promise<string> {
  const src = URL.createObjectURL(new Blob([bytes], { type: mime }));
  try {
    const img = new Image();
    img.src = src;
    await img.decode();
    // 크기 없는 SVG(viewBox 만)는 0 이 온다
    const size =
      img.naturalWidth > 0 && img.naturalHeight > 0
        ? fitWithin(img.naturalWidth, img.naturalHeight, edge)
        : { w: edge, h: edge };
    const canvas = document.createElement("canvas");
    canvas.width = size.w;
    canvas.height = size.h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    // 큰 그림을 수십 분의 일로 줄인다 — 기본 품질은 계단이 진다
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, size.w, size.h);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.85));
    if (!blob) throw new Error("toBlob failed");
    return URL.createObjectURL(blob);
  } finally {
    URL.revokeObjectURL(src);
  }
}

export class FileThumbs {
  #h: FileThumbsHost;

  /** 열쇠 → 줄인 그림 URL */
  urls = $state.raw<ReadonlyMap<string, string>>(new Map());
  /** 줄에 섰거나 읽는 중인 열쇠 */
  pending = $state.raw<ReadonlySet<string>>(new Set());

  /** `urls` 의 열쇠를 오래된 순서로 — 보일 때마다 뒤로 옮긴다. 반응형이 아니다(스크롤마다 목록을 다시 그리지 않게) */
  #recent = new Set<string>();
  #nodes = new Map<Element, Watched>();
  #io: IntersectionObserver | null = null;
  #queue: Job[] = [];
  #reading = new Set<string>();
  /** 같은 열쇠로 되풀이해 읽지 않는다 */
  #failed = new Set<string>();
  #disposed = false;

  constructor(host: FileThumbsHost) {
    this.#h = host;
  }

  #keyOf(entry: SftpEntry): string | null {
    const h = this.#h;
    if (h.offline || !thumbable(entry, thumbMaxBytes(h.isLocal, h.remoteWindow))) return null;
    return thumbKey(h.backend.key, entry);
  }

  /** 관찰할 칸인가 — 끊기면 거짓이 되어 관찰을 떼고, 다시 붙어 관찰을 걸면 관찰자가 보이는 칸을 처음부터 다시 알려 준다 */
  wants(entry: SftpEntry): boolean {
    return this.#keyOf(entry) !== null;
  }

  urlOf(entry: SftpEntry): string | undefined {
    const key = this.#keyOf(entry);
    return key === null ? undefined : this.urls.get(key);
  }

  isPending(entry: SftpEntry): boolean {
    const key = this.#keyOf(entry);
    return key !== null && this.pending.has(key);
  }

  /** `use:` 손잡이 — 그림이 아닌 칸이나 다른 보기에서는 `null` 을 넘겨 관찰을 뗀다 */
  watch = (node: HTMLElement, entry: SftpEntry | null) => {
    const set = (next: SftpEntry | null) => {
      const was = this.#nodes.get(node);
      if (next === null) {
        if (!was) return;
        this.#nodes.delete(node);
        this.#io?.unobserve(node);
        this.#unqueue(was.entry.path);
        return;
      }
      if (was) {
        if (was.entry.path !== next.path) this.#unqueue(was.entry.path);
        was.entry = next;
        if (was.visible) this.#want(next);
        return;
      }
      this.#nodes.set(node, { entry: next, visible: false });
      this.#io?.observe(node);
    };
    set(entry);
    return { update: set, destroy: () => set(null) };
  };

  /** 뿌리 = 목록 상자 · 아이콘 보기에서만 붙인다. 돌려준 함수가 뗀다 */
  attach(root: HTMLElement): () => void {
    const io = new IntersectionObserver(
      (records) => {
        for (const r of records) {
          const w = this.#nodes.get(r.target);
          if (!w) continue;
          w.visible = r.isIntersecting;
          if (w.visible) this.#want(w.entry);
          else this.#unqueue(w.entry.path);
        }
      },
      { root, rootMargin: "64px 0px" },
    );
    this.#io = io;
    for (const node of this.#nodes.keys()) io.observe(node);
    return () => {
      io.disconnect();
      if (this.#io === io) this.#io = null;
      for (const w of this.#nodes.values()) w.visible = false;
      this.#queue = [];
      this.#syncPending();
    };
  }

  /** `backend.key` 가 바뀌었을 때 — 관찰자는 이미 보이는 칸을 다시 알려 주지 않는다 */
  revisit(): void {
    for (const w of this.#nodes.values()) if (w.visible) this.#want(w.entry);
  }

  dispose(): void {
    this.#disposed = true;
    this.#io?.disconnect();
    this.#io = null;
    this.#nodes.clear();
    this.#queue = [];
    for (const url of this.urls.values()) URL.revokeObjectURL(url);
    this.urls = new Map();
    this.#recent.clear();
    this.pending = new Set();
  }

  #want(entry: SftpEntry): void {
    const key = this.#keyOf(entry);
    if (key === null || this.#failed.has(key)) return;
    if (this.urls.has(key)) {
      // 상한에서 거둘 때 화면 밖 것이 먼저 나가게
      this.#recent.delete(key);
      this.#recent.add(key);
      return;
    }
    if (this.pending.has(key)) return;
    this.#queue.push({ key, entry });
    this.#syncPending();
    this.#pump();
  }

  #unqueue(path: string): void {
    const before = this.#queue.length;
    this.#queue = this.#queue.filter((j) => j.entry.path !== path);
    if (this.#queue.length !== before) this.#syncPending();
  }

  #syncPending(): void {
    const next = new Set(this.#reading);
    for (const j of this.#queue) next.add(j.key);
    this.pending = next;
  }

  #pump(): void {
    while (!this.#disposed && this.#reading.size < THUMB_CONCURRENCY && this.#queue.length > 0) {
      const job = this.#queue.shift()!;
      // 줄에 선 사이 끊겼거나 다시 붙었으면 버린다 — 보이는 칸은 `revisit` 이 다시 세운다
      if (this.#h.offline || this.#keyOf(job.entry) !== job.key) continue;
      void this.#run(job, this.#h.backend);
    }
    this.#syncPending();
  }

  async #run(job: Job, backend: FsBackend): Promise<void> {
    this.#reading.add(job.key);
    try {
      const bytes = await backend.readPreview(job.entry.path);
      const url = await shrink(bytes, imageMime(job.entry.name) ?? "", thumbEdge(window.devicePixelRatio));
      if (this.#disposed) {
        URL.revokeObjectURL(url);
        return;
      }
      const next = new Map(this.urls);
      next.set(job.key, url);
      this.#recent.add(job.key);
      for (const old of this.#recent) {
        if (this.#recent.size <= THUMB_CACHE_MAX) break;
        const gone = next.get(old);
        if (gone !== undefined) URL.revokeObjectURL(gone);
        next.delete(old);
        this.#recent.delete(old);
      }
      this.urls = next;
    } catch {
      // 못 읽은 그림은 글리프 그대로 — 문구 · 토스트 없음
      this.#failed.add(job.key);
    } finally {
      this.#reading.delete(job.key);
      this.#pump();
    }
  }
}
