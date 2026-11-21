import { toast } from "$lib/toast.svelte";
import { LOCAL_KEY, type FsBackend } from "$lib/fs-backend";
import type { FsClipMode } from "$lib/fs-clipboard.svelte";
import {
  decodeFsDrag,
  encodeFsDrag,
  fsDragActive,
  fsDragEmpty,
  setFsDragActive,
  FS_DRAG_TYPE,
} from "$lib/fs-drag";
import { backendFromKey } from "$lib/fs-backend";
import { nativeDragBlocker, nativeDragIcon, startNativeDrag } from "$lib/native-drag";
import { isRemote } from "$lib/ipc";
import { isDirLike, type SftpEntry } from "$lib/sftp-browser";
import { dragMode, dropEffectOf } from "$lib/fs-route";
import { setCountGhost, dropGhost } from "$lib/browser/drag-ghost";
import type { SelectionController } from "$lib/browser/selection-controller.svelte";
import { t } from "$lib/i18n/i18n.svelte.js";

/**
 * 파일 타일의 드래그 — 앱 안 드래그와 탐색기로 끌어내기(네이티브)가 한 몸짓에서 갈린다
 * (docs/log/2026-09-04-native-drag-out.md).
 *
 * WebView2 는 `dragstart` 중에 소스 요소가 조금이라도 바뀌면 드래그를 통째로 취소한다 — 화면을 바꾸는 대입은 한 틱 미룬다.
 *
 * 끌어내기는 웹 드래그가 태어나지 않게 한다(`pointerdown` 에서 `preventDefault` → 문턱을 넘으면 `start_drag`).
 * `dragstart` 안에서 막고 부르면 크로미움이 캡처를 쥐었다 놓는 사이라 OLE `QueryContinueDrag` 가 버튼을 못 보고 곧바로 `Dropped` 로 끝난다.
 * `setPointerCapture` 는 걸지 않는다 — OLE 의 `DoDragDrop` 이 캡처를 가져가야 한다.
 */
export interface FsDragHost {
  backend: () => FsBackend;
  /** 줄마다 묻는다 — 트리 보기에서는 한 화면에 드라이브 뿌리와 그 안의 파일이 함께 선다 */
  locked: (path: string) => boolean;
  offline: () => boolean;
  order: () => readonly string[];
  selection: SelectionController;
  busy: () => boolean;
  canReceive: (dir: string) => boolean;
  bringIn: (
    src: FsBackend,
    paths: readonly string[],
    destDir: string,
    mode: FsClipMode,
  ) => Promise<void>;
  /** 트리 보기의 줄 위에 놓았을 때만 온다 — 빈 바닥의 OS 파일은 `PaneHost` 가 받는다 */
  receiveFiles?: (dir: string, files: File[]) => void;
}

const NATIVE_DRAG_MIN_PX = 4;

export class DragController {
  #host: FsDragHost;

  #draggingPaths = $state<ReadonlySet<string> | null>(null);
  #dropDir = $state<string | null>(null);
  #nativeDragging = $state(false);

  #timer: ReturnType<typeof setTimeout> | null = null;

  /** `rowEl` 은 시동 중 `draggable` 을 직접 꺼 두었다가 풀 때 되돌리려고 든다 */
  #arm: {
    pointerId: number;
    x: number;
    y: number;
    entry: SftpEntry;
    rowEl: HTMLElement | null;
    started: boolean;
  } | null = null;

  constructor(host: FsDragHost) {
    this.#host = host;
  }

  get draggingPaths(): ReadonlySet<string> | null {
    return this.#draggingPaths;
  }

  get dropDir(): string | null {
    return this.#dropDir;
  }

  get nativeDragging(): boolean {
    return this.#nativeDragging;
  }

  canDrag(path: string): boolean {
    return !this.#host.locked(path) && !this.#host.offline();
  }

  // ── 앱 안 드래그 ──

  /** 시동이 걸린 포인터에서 `dragstart` 가 새어 나오면 조용히 막는다 — 끌어내기는 [`armExport`] 의 길이다 */
  startDrag = (ev: DragEvent, entry: SftpEntry): void => {
    if (this.#arm) {
      ev.preventDefault();
      return;
    }
    const backend = this.#host.backend();
    const dt = ev.dataTransfer;
    console.debug("[드래그] 앱 안 시작", { path: entry.path, local: backend.key === LOCAL_KEY });
    if (!dt || !this.canDrag(entry.path)) return;
    const order = this.#host.order();
    const next = this.#host.selection.forDrag(entry.path, order);
    const paths = order.filter((p) => next.ids.has(p));
    if (paths.length === 0 || paths.some((p) => this.#host.locked(p))) return;

    const payload = { backendKey: backend.key, paths };
    setFsDragActive(payload);
    dt.setData(FS_DRAG_TYPE, encodeFsDrag(payload));
    dt.setData("text/plain", paths.join("\n"));
    // 실제 커서는 받는 쪽이 정한다([`dirDragOver`])
    dt.effectAllowed = "copyMove";
    setCountGhost(dt, paths.length, t("files.drag.count", { count: paths.length }));
    this.#timer = setTimeout(() => {
      this.#timer = null;
      dropGhost();
      this.#host.selection.set(next);
      this.#draggingPaths = next.ids;
    }, 0);
  };

  /** `dragover` 에서는 종류만 보인다 */
  #isFsDrag(ev: DragEvent): boolean {
    return ev.dataTransfer?.types.includes(FS_DRAG_TYPE) ?? false;
  }

  #isOsFiles(ev: DragEvent): boolean {
    const types = ev.dataTransfer?.types;
    return !!types && types.includes("Files") && !types.includes(FS_DRAG_TYPE);
  }

  /**
   * 전파를 끊지 않는다 — `PaneHost` 의 `onDragOver` 가 이 줄(`data-inner-drop-files`)을 보고 타일 전체 덮개를 거둬야 한다.
   * 끊으면 덮개가 남고, OS 드래그에는 `dragend` 도 없어 다음 드래그까지 떠 있다.
   */
  #filesDragOver(ev: DragEvent, dir: string): void {
    if (!this.#host.receiveFiles || !this.#host.canReceive(dir) || this.#host.busy()) return;
    ev.preventDefault();
    if (ev.dataTransfer) ev.dataTransfer.dropEffect = "copy";
    if (this.#dropDir !== dir) this.#dropDir = dir;
  }

  /**
   * 값을 못 읽는 단계라 출발지는 이 창의 `fsDragActive` 로 따진다(남의 창이면 `null`).
   * 커서와 놓았을 때의 뜻은 같은 [`dragMode`] 에서 나와야 한다 — 갈리면 커서가 거짓말을 한다.
   */
  dirDragOver = (ev: DragEvent, dir: string, files = false): void => {
    if (files && this.#isOsFiles(ev)) {
      this.#filesDragOver(ev, dir);
      return;
    }
    if (!this.#isFsDrag(ev) || !this.#host.canReceive(dir) || this.#host.busy()) return;
    ev.preventDefault();
    ev.stopPropagation();
    const mode = dragMode(fsDragActive()?.backendKey ?? null, this.#host.backend().key, {
      ctrl: ev.ctrlKey,
      shift: ev.shiftKey,
    });
    if (ev.dataTransfer) ev.dataTransfer.dropEffect = dropEffectOf(mode);
    if (this.#dropDir !== dir) this.#dropDir = dir;
  };

  dirDragLeave = (dir: string): void => {
    if (this.#dropDir === dir) this.#dropDir = null;
  };

  applyDrop = (ev: DragEvent, dir: string, files = false): void => {
    if (files && this.#isOsFiles(ev)) {
      // 막지 않으면 웹뷰가 그 파일로 이동해 버린다
      ev.preventDefault();
      ev.stopPropagation();
      this.#dropDir = null;
      const list = Array.from(ev.dataTransfer?.files ?? []);
      if (list.length > 0 && this.#host.canReceive(dir) && !this.#host.busy()) {
        this.#host.receiveFiles?.(dir, list);
      }
      return;
    }
    if (!this.#isFsDrag(ev)) return;
    ev.preventDefault();
    ev.stopPropagation();
    this.#dropDir = null;
    const payload = decodeFsDrag(ev.dataTransfer?.getData(FS_DRAG_TYPE) ?? "");
    if (fsDragEmpty(payload)) return;
    // 남의 창에서 온 원격 짐은 거절한다 — 세션 번호는 창마다 도는 카운터라 `ssh:2` 가 저쪽과 다른 서버일 수 있다
    if (payload.backendKey !== LOCAL_KEY && fsDragActive() === null) {
      toast.error(t("files.drag.remote.otherwindow"));
      return;
    }
    const src = backendFromKey(payload.backendKey);
    if (!src) {
      toast.error(t("files.drag.source.gone"));
      return;
    }
    const mode = dragMode(payload.backendKey, this.#host.backend().key, {
      ctrl: ev.ctrlKey,
      shift: ev.shiftKey,
    });
    void this.#host.bringIn(src, payload.paths, dir, mode);
  };

  // ── 탐색기로 끌어내기 ──

  /**
   * `draggable` 은 DOM 에서 직접 끈다 — 스벨트 상태로 돌리면 갱신이 한 틱 뒤라 크로미움이 드래그를 여는 순간에 못 맞춘다.
   * `stopPropagation` 이 빠지면 손잡이의 누르기가 줄로 올라가 시동이 두 번 걸린다.
   * 거절 판정은 문턱을 넘은 뒤([`#startNative`]) — 여기서 하면 클릭 한 번에 오류 토스트가 뜬다.
   */
  armExport = (ev: PointerEvent, entry: SftpEntry, via: "grip" | "Alt"): void => {
    if (ev.button !== 0 || this.#host.locked(entry.path) || this.#host.offline()) return;
    if (this.#arm) return;
    ev.preventDefault();
    ev.stopPropagation();
    const rowEl = ev.target instanceof Element ? ev.target.closest<HTMLElement>(".row") : null;
    if (rowEl) rowEl.draggable = false;
    this.#arm = { pointerId: ev.pointerId, x: ev.clientX, y: ev.clientY, entry, rowEl, started: false };
    console.debug("[내보내기] 시동", {
      via,
      path: entry.path,
      local: this.#host.backend().key === LOCAL_KEY,
    });
  };

  rowPointerDown = (ev: PointerEvent, entry: SftpEntry): void => {
    if (!ev.altKey) return;
    this.armExport(ev, entry, "Alt");
  };

  pointerMove = (ev: PointerEvent): void => {
    const arm = this.#arm;
    if (!arm || arm.started || ev.pointerId !== arm.pointerId) return;
    if (
      Math.abs(ev.clientX - arm.x) < NATIVE_DRAG_MIN_PX &&
      Math.abs(ev.clientY - arm.y) < NATIVE_DRAG_MIN_PX
    ) {
      return;
    }
    arm.started = true;
    this.#startNative(arm.entry);
  };

  /** 네이티브 드래그에는 `dragend` 가 없다 — 끝 콜백을 놓쳤을 때의 보험도 이 줄이다 */
  pointerEnd = (ev: PointerEvent): void => {
    if (this.#arm && ev.pointerId === this.#arm.pointerId) this.#disarm();
    if (this.#nativeDragging) this.cleanup();
  };

  #disarm(): void {
    const arm = this.#arm;
    if (arm?.rowEl) arm.rowEl.draggable = this.canDrag(arm.entry.path);
    this.#arm = null;
  }

  /**
   * 순서가 계약이다(`native-drag.ts` 머리말): 거절 검사가 먼저 — 플러그인은 셸 항목을 못 만들면 패닉한다(앱이 죽는다).
   * `startNativeDrag` 는 `await` 없이 — 한 틱이라도 늦으면 버튼이 떼어져 시작하자마자 놓인다(아이콘도 그 앞에서 동기로 그린다).
   */
  #startNative(entry: SftpEntry): void {
    const order = this.#host.order();
    const next = this.#host.selection.forDrag(entry.path, order);
    const paths = order.filter((p) => next.ids.has(p));
    if (paths.length === 0) return;
    // 원격 웹 클라이언트에는 메인 PC 탐색기가 없다
    if (isRemote) return;
    if (this.#host.backend().key !== LOCAL_KEY) {
      toast.error(t("files.drag.remote.noexport"));
      return;
    }
    const blocked = nativeDragBlocker(paths);
    if (blocked) {
      toast.error(t(blocked.key, blocked.params));
      return;
    }
    const icon = nativeDragIcon(
      paths.length,
      isDirLike(entry),
      t("files.drag.count", { count: paths.length }),
    );
    startNativeDrag(paths, icon, () => this.cleanup(), (message) => {
      toast.error(t("files.drag.export.fail", { message }));
    });
    // 웹 드래그가 없으므로 화면을 지금 바꿔도 안전하다
    this.#nativeDragging = true;
    this.#host.selection.set(next);
    this.#draggingPaths = next.ids;
  }

  /** 여러 길에서 여러 번 불린다 — 멱등을 지킨다 */
  cleanup = (): void => {
    if (this.#timer !== null) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
    dropGhost();
    setFsDragActive(null);
    this.#draggingPaths = null;
    this.#dropDir = null;
    this.#nativeDragging = false;
    this.#disarm();
  };
}

export function createDragController(host: FsDragHost): DragController {
  return new DragController(host);
}
