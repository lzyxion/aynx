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
 * **파일 타일의 드래그** — 앱 안 드래그(타일 ↔ 타일)와 탐색기로 끌어내기(네이티브)가 한
 * 몸짓에서 갈리므로 한 자리에 있다 (docs/log/2026-09-04-fs-multiselect-clipboard.md ·
 * docs/log/2026-09-04-native-drag-out.md).
 *
 * ## 앱 안 드래그
 *
 * 짐은 `application/x-aynx-files` 하나이고 값은 `{ backendKey, paths }` 다. **놓는 곳이
 * 뜻을 정한다** — 놓을 수 있는 곳은 셋이다: 폴더 줄 · 빵부스러기 조각 · 목록의 빈 바닥
 * (= 지금 폴더). 터미널 타일 위에 놓는 길은 `PaneHost` 가 받아 경로를 셸 인용해 붙여넣는다.
 *
 * WebView2(Chromium) 규칙: `dragstart` 가 도는 중에 소스 요소가 조금이라도 움직이면 드래그가
 * **통째로 취소**되므로, 화면을 바꾸는 대입은 전부 한 틱 미룬다.
 *
 * ## 탐색기로 끌어내기 — 크로미움 드래그를 **태어나지 않게** 한다
 *
 * 시동을 거는 자리는 둘이고 그 뒤는 완전히 같은 길이다: **내보내기 손잡이**(줄 오른쪽 끝)와
 * **`Alt`+누르기**. 예전 길은 `dragstart` 안에서 `preventDefault()` 하고 곧바로 `start_drag`
 * 를 부르는 것이었는데, 실기에서 네이티브 드래그가 **수 ms 만에 `Dropped`** 로 끝났다:
 * 플러그인의 `IDropSource::QueryContinueDrag` 는 `grfKeyState` 에 `MK_LBUTTON` 이 없으면
 * 그 자리에서 `DRAGDROP_S_DROP` 을 돌려주는데, 그 시점은 크로미움이 자기 드래그 세션을 막
 * 열며 마우스 캡처를 쥐었다 놓는 사이라 OLE 에게는 버튼이 **안 눌린 것으로** 보인다.
 *
 * 그래서 웹 드래그를 "죽이는" 대신 태어나지 않게 한다: `pointerdown` 에서 곧바로
 * `preventDefault()` 하고, 손이 4px 를 움직인 순간 `start_drag` 를 부른다. 그때 왼쪽 버튼은
 * 계속 눌린 채다. `setPointerCapture` 는 **걸지 않는다** — OLE 의 `DoDragDrop` 이 캡처를
 * 가져가야 한다.
 */
export interface FsDragHost {
  backend: () => FsBackend;
  /**
   * 이 항목을 **끌 수 없는 자리**인가 — "내 PC" 의 드라이브 뿌리처럼 옮길 수도 내보낼 수도 없는 것.
   *
   * 예전에는 타일 전체의 `atRoot()` 하나였다(합성 루트를 보고 있으면 줄 전부가 드라이브였다).
   * 트리 보기에서는 "내 PC" 아래로 `C:\` 를 펼치면 **한 화면에 드라이브와 그 안의 파일이 함께**
   * 서므로 줄마다 물어야 한다 (docs/log/2026-09-25-file-tree-view.md).
   */
  locked: (path: string) => boolean;
  offline: () => boolean;
  /** 지금 보이는 순서대로의 경로 목록 — 드래그가 실을 것을 이 순서로 편다 */
  order: () => readonly string[];
  selection: SelectionController;
  /** 전송·확인이 걸려 있는가 — 그동안에는 드롭을 받지 않는다 */
  busy: () => boolean;
  /** 이 자리가 받을 수 있는 폴더인가 */
  canReceive: (dir: string) => boolean;
  /** 짐 하나를 이 폴더로 (붙여넣기와 같은 몸통) */
  bringIn: (
    src: FsBackend,
    paths: readonly string[],
    destDir: string,
    mode: FsClipMode,
  ) => Promise<void>;
  /**
   * **OS 파일**(탐색기에서 끌어온 `File`)을 이 폴더로 — 트리 보기의 줄 위에 놓았을 때만 온다.
   * 빈 바닥에 놓은 것은 예전 그대로 타일(`PaneHost`)이 받아 뿌리로 보낸다.
   */
  receiveFiles?: (dir: string, files: File[]) => void;
}

/** 시동을 건 뒤 네이티브 드래그로 넘어가는 이동 문턱(px) — 클릭과 구별되는 최소치 */
const NATIVE_DRAG_MIN_PX = 4;

export class DragController {
  #host: FsDragHost;

  /** 반투명하게 그릴 경로들 (한 틱 미뤄 켠다 — 위 WebView2 규칙) */
  #draggingPaths = $state<ReadonlySet<string> | null>(null);
  /** 지금 드래그가 올라가 있는 목적지 경로 (강조). `null` 이면 아무 데도 아니다 */
  #dropDir = $state<string | null>(null);
  /** 지금 **네이티브(OS) 드래그**가 도는 중인가 — 끝 신호를 놓쳤을 때의 보험이 이 값을 본다 */
  #nativeDragging = $state(false);

  #timer: ReturnType<typeof setTimeout> | null = null;

  /**
   * 시동을 걸어 둔 줄. 문턱을 넘으면 `started` 가 서고 다시는 시작하지 않는다. 화면이 이
   * 값을 읽지 않으므로 `$state` 가 아니다.
   *
   * `rowEl` 은 그 줄의 DOM 이다 — 시동 중에는 `draggable` 을 **직접 꺼 두었다가** 풀 때
   * 되돌리기 위해 들고 있는다.
   */
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

  /** 이 줄에 `draggable` 을 붙일 자리인가 (드라이브 뿌리·끊긴 연결에서는 끌 것이 없다) */
  canDrag(path: string): boolean {
    return !this.#host.locked(path) && !this.#host.offline();
  }

  // -------------------------------------------------------------------------
  // 앱 안 드래그
  // -------------------------------------------------------------------------

  /**
   * 줄에서 시작한 드래그 — **고른 것을 끌면 선택 전체가, 고르지 않은 것을 끌면 그것 하나만**
   * 실린다 (탐색기의 관례).
   *
   * **내보내기 갈래는 여기 없다**: 탐색기로 끌어내는 길은 [`armExport`] 가 웹 드래그가
   * **태어나기 전에** 가져간다. 그래도 시동이 걸린 포인터에서 `dragstart` 가 새어 나오면
   * 여기서 **조용히** 막아 세운다 — 로그도 남기지 않는다.
   */
  startDrag = (ev: DragEvent, entry: SftpEntry): void => {
    if (this.#arm) {
      ev.preventDefault();
      return;
    }
    const backend = this.#host.backend();
    const dt = ev.dataTransfer;
    // 진단 한 줄 — 여기까지 왔으면 **앱 안 드래그**가 시작된 것이다.
    console.debug("[드래그] 앱 안 시작", { path: entry.path, local: backend.key === LOCAL_KEY });
    if (!dt || !this.canDrag(entry.path)) return;
    const order = this.#host.order();
    const next = this.#host.selection.forDrag(entry.path, order);
    const paths = order.filter((p) => next.ids.has(p));
    if (paths.length === 0 || paths.some((p) => this.#host.locked(p))) return;

    const payload = { backendKey: backend.key, paths };
    setFsDragActive(payload);
    dt.setData(FS_DRAG_TYPE, encodeFsDrag(payload));
    // 앱 밖(에디터·터미널)으로 떨어뜨렸을 때를 위한 예의 — 경로가 줄줄이 글자로 떨어진다
    dt.setData("text/plain", paths.join("\n"));
    // 둘 다 허용하고 실제 커서는 **받는 쪽**이 정한다 ([`dirDragOver`])
    dt.effectAllowed = "copyMove";
    setCountGhost(dt, paths.length, t("files.drag.count", { count: paths.length }));
    this.#timer = setTimeout(() => {
      this.#timer = null;
      dropGhost();
      this.#host.selection.set(next);
      this.#draggingPaths = next.ids;
    }, 0);
  };

  /** 이 드래그가 우리 짐인가 — `dragover` 에서는 **종류만** 보인다 */
  #isFsDrag(ev: DragEvent): boolean {
    return ev.dataTransfer?.types.includes(FS_DRAG_TYPE) ?? false;
  }

  /** OS 파일 드래그인가 (탐색기에서 끌어온 것 — 앱 안 짐이 아니다) */
  #isOsFiles(ev: DragEvent): boolean {
    const types = ev.dataTransfer?.types;
    return !!types && types.includes("Files") && !types.includes(FS_DRAG_TYPE);
  }

  /**
   * **OS 파일을 줄 위에서 받는다** — 트리 보기 전용 (`files` 가 참일 때만 [`dirDragOver`] 가 여기로
   * 넘긴다). 받는 쪽이 줄이라 타일 전체 하이라이트(`PaneHost` 의 "여기로 업로드") 대신 **그 폴더 줄**이
   * 밝아진다 — 줄에 `data-inner-drop-files` 가 붙어 있어 `PaneHost` 가 이 자리를 양보한다.
   */
  #filesDragOver(ev: DragEvent, dir: string): void {
    if (!this.#host.receiveFiles || !this.#host.canReceive(dir) || this.#host.busy()) return;
    ev.preventDefault();
    ev.stopPropagation();
    if (ev.dataTransfer) ev.dataTransfer.dropEffect = "copy";
    if (this.#dropDir !== dir) this.#dropDir = dir;
  }

  /**
   * 드롭을 받아 주고 커서를 정한다. 값을 못 읽는 단계라 **어디서 왔는지**는 이 창의
   * 손안의 값(`fsDragActive`)으로 따진다 — 남의 창에서 온 드래그면 그 값이 없으므로
   * `null` 로 넘긴다(`dragMode` 가 그 칸을 안다). 남의 창의 **원격** 짐을 거절하는 판정은
   * 여기서 하지 않고 놓는 순간에 한다 (그것이 [`applyDrop`] 의 첫 줄이다).
   *
   * 뜻과 커서가 [`dragMode`]·[`dropEffectOf`] **한 자리에서** 나온다 — 놓았을 때와 계산이
   * 갈리면 커서가 거짓말을 하게 된다. 수정키를 드래그 도중에 눌렀다 떼도 크로미움이
   * `dragover` 를 다시 쏘므로 커서는 저절로 따라온다.
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

  /**
   * 놓았다 — 짐을 펴서 `bringIn` 으로. 수정키의 뜻은 탐색기의 관례 그대로다: **`Ctrl` 은
   * 언제나 복사**, **`Shift` 는 언제나 이동**(계층을 넘어서도). 위 `dragover` 가 커서로 이미
   * 그렇게 예고했다 — 같은 [`dragMode`] 를 부르기 때문이다.
   */
  applyDrop = (ev: DragEvent, dir: string, files = false): void => {
    if (files && this.#isOsFiles(ev)) {
      // OS 파일 — 받을 수 있는 자리였으면(`dragover` 가 받아 줬다) 그 폴더로 올린다. 막지 않으면
      // 웹뷰가 그 파일로 이동해 버리므로 `preventDefault` 는 여기서도 필수다.
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
    // 남의 창에서 온 **원격** 짐은 거절한다: 세션 번호는 창마다 도는 카운터라 여기서 편
    // `ssh:2` 가 저쪽의 `ssh:2` 와 다른 서버일 수 있다 (`fsDragActive` 주석).
    if (payload.backendKey !== LOCAL_KEY && fsDragActive() === null) {
      toast.error(t("files.drag.remote.otherwindow"));
      return;
    }
    const src = backendFromKey(payload.backendKey);
    if (!src) {
      toast.error(t("files.drag.source.gone"));
      return;
    }
    // 판정은 `dragover` 와 **같은 함수**에서 나온다 — 그래서 놓는 순간 뜻이 달라지는 일이
    // 없다. 여기서는 짐을 폈으므로 출발지를 확실히 안다 (위 `dragover` 의 `null` 칸이 아니다).
    const mode = dragMode(payload.backendKey, this.#host.backend().key, {
      ctrl: ev.ctrlKey,
      shift: ev.shiftKey,
    });
    void this.#host.bringIn(src, payload.paths, dir, mode);
  };

  // -------------------------------------------------------------------------
  // 탐색기로 끌어내기 (로컬 전용)
  // -------------------------------------------------------------------------

  /**
   * **내보내기 시동** — 손잡이 누르기와 `Alt`+누르기가 함께 들어오는 한 문.
   *
   * 하는 일이 셋이다:
   *
   * 1. `preventDefault()` — 글자 선택도, HTML5 드래그 시작도 여기서 멈춘다.
   * 2. 줄의 `draggable` 을 **DOM 에서 직접** 끈다. 속성 값을 스벨트 상태로 돌리면 갱신이 한
   *    틱 뒤라 크로미움이 드래그를 여는 순간에 못 맞춘다. 풀 때 되돌린다.
   * 3. `stopPropagation()` — 손잡이에서 누른 것이 줄로 올라가 **시동이 두 번** 걸리는 것을 막는다.
   *
   * 거절(원격·"내 PC"·차단 경로)은 여기서 하지 않는다. 누르기만 하고 안 움직인 손에 토스트를
   * 세우면 클릭 한 번에 오류가 뜨는 꼴이라, 판정은 문턱을 넘은 뒤 [`#startNative`] 가 맡는다.
   */
  armExport = (ev: PointerEvent, entry: SftpEntry, via: "grip" | "Alt"): void => {
    if (ev.button !== 0 || this.#host.locked(entry.path) || this.#host.offline()) return;
    if (this.#arm) return; // 한 몸짓에 한 번만
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

  /** 줄 위에서 `Alt`+왼쪽 버튼 — 손잡이를 안 쓰는 보조 길 */
  rowPointerDown = (ev: PointerEvent, entry: SftpEntry): void => {
    if (!ev.altKey) return;
    this.armExport(ev, entry, "Alt");
  };

  /** 창 전역 `pointermove` — 문턱을 넘는 순간 **한 번만** 네이티브로 넘어간다 */
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

  /**
   * 버튼을 뗐거나 포인터가 취소됐다. **문턱을 넘기 전이면 아무 일도 없다** — 그냥 클릭이었고
   * 선택 규칙은 `onclick` 이 이미 처리했다. 같은 줄이 네이티브 드래그의 **보험**도 겸한다.
   */
  pointerEnd = (ev: PointerEvent): void => {
    if (this.#arm && ev.pointerId === this.#arm.pointerId) this.#disarm();
    if (this.#nativeDragging) this.cleanup();
  };

  /** 시동을 풀고 줄의 `draggable` 을 되돌린다 — 앱 안 드래그가 다시 살아나는 자리다 */
  #disarm(): void {
    const arm = this.#arm;
    if (arm?.rowEl) arm.rowEl.draggable = this.canDrag(arm.entry.path);
    this.#arm = null;
  }

  /**
   * **탐색기로 끌어내기** — 로컬 파일만. [`pointerMove`] 가 문턱을 넘은 순간 부른다.
   *
   * 순서가 계약이다 (`native-drag.ts` 머리말):
   *
   * 1. 거절 검사 — 플러그인의 윈도우 경로는 셸 항목을 못 만들면 **패닉**한다(앱이 죽는다).
   * 2. `startNativeDrag` 를 **`await` 없이** — 한 틱이라도 늦으면 그 사이 버튼이 떼어져
   *    시작하자마자 놓인 것으로 처리된다. 그래서 아이콘도 이 앞에서 **동기로** 그린다.
   *
   * 웹 드래그가 아예 없으므로 `dragend` 도 없다. 정리는 플러그인 콜백이 맡고, 그마저 못 오는
   * 경우를 위해 창 `pointerup` 이 보험으로 한 번 더 부른다.
   */
  #startNative(entry: SftpEntry): void {
    const order = this.#host.order();
    const next = this.#host.selection.forDrag(entry.path, order);
    const paths = order.filter((p) => next.ids.has(p));
    if (paths.length === 0) return;
    // 원격 웹 클라이언트(R1a-3)에는 집 PC 탐색기가 없다 — 끌어내기를 시작하지 않는다.
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
    // 셋째 인자가 정리, 넷째가 **거절 문구**다. 플러그인 명령이 거절되면(권한·역직렬화·
    // 셸 항목 실패) 예전에는 그 사실이 조용히 사라져 "아무 일도 안 일어남" 으로 보였다.
    startNativeDrag(paths, icon, () => this.cleanup(), (message) => {
      toast.error(t("files.drag.export.fail", { message }));
    });
    // 웹 드래그가 없으므로 화면을 지금 바꿔도 안전하다.
    this.#nativeDragging = true;
    this.#host.selection.set(next);
    this.#draggingPaths = next.ids;
  }

  /**
   * 드래그 하나의 뒷정리 — `dragend`(앱 안), 네이티브 끝 콜백, `pointerup` 보험이 모두
   * 이것을 부른다. 여러 번 불려도 안전하도록 **전부 멱등**하게 적어 둔다.
   */
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
