// 파일 타일의 키보드. 글자 시계를 거두는 `$effect` 는 `SftpBrowser` 에 있다.
import type { SftpEntry } from "$lib/sftp-browser";
import type { FsClipMode } from "$lib/fs-clipboard.svelte";
import { findByPrefix, firstChildId, isAuxId, parentRowId, type FileTreeRow } from "$lib/file-tree";
import { comboFromEvent, isEditableTarget } from "$lib/keybindings";
import { gridStep, type ArrowKey, type GridFlow } from "$lib/browser/file-view";
import type { FileView } from "$lib/session";
import type { NavController } from "$lib/browser/nav-controller.svelte";
import type { SelectionController } from "$lib/browser/selection-controller.svelte";
import type { Transfers } from "$lib/browser/fs-transfer.svelte";
import type { FileListing } from "$lib/browser/file-listing.svelte";
import type { FileMenuAnchor, FileMenuController } from "$lib/browser/file-menu-controller.svelte";

/** 전부 게터라 그때그때의 값이다 */
export interface FileKeysHost {
  /** 보이는 활성 타일 — 창에 하나뿐이라 타일 여럿이 같은 키를 두고 다투지 않는다 */
  readonly active: boolean;
  readonly pathFocused: boolean;
  /** 사용자 오버라이드를 지난 `조합 → 액션 id` */
  readonly fileBindings: ReadonlyMap<string, string>;
  readonly transfers: Transfers;
  readonly menus: FileMenuController;
  readonly listing: FileListing;
  readonly nav: NavController;
  readonly sel: SelectionController;
  readonly order: string[];
  readonly navOrder: string[];
  readonly rows: readonly FileTreeRow[];
  readonly rowById: Map<string, FileTreeRow>;
  readonly isTree: boolean;
  readonly view: FileView;
  readonly focusEntry: SftpEntry | null;
  readonly targetDir: string;
  readonly listEl: HTMLDivElement | null;
  copySelection(mode: FsClipMode): void;
  pasteInto(dir: string): void;
  openEntry(entry: SftpEntry): void;
  isRootItem(path: string): boolean;
  targets(): string[];
  /** 모르는 id 면 `false` */
  runFileAction(id: string): boolean;
}

const TYPE_AHEAD_MS = 800;

export class FileKeys {
  #h: FileKeysHost;

  typeAhead = "";
  typeAheadTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(h: FileKeysHost) {
    this.#h = h;
  }

  /**
   * 창 전역에서 잡고 `active` 로 거른다 — 목록은 포커스를 받을 수 없는 `<div>` 라 키가 오지 않는다.
   * 버튼 위의 Enter · Space 는 비켜 간다 — 여기서 또 "열기" 로 읽으면 한 번에 두 가지가 일어난다.
   * 전역 조합(`Alt+화살표` · `Ctrl+D` …)은 여기서 아무것도 하지 않고 지나간다 (docs/log/2026-09-03-hosts-toolbar-tile-focus.md).
   */
  onKeydown = (ev: KeyboardEvent) => {
    const h = this.#h;
    if (!h.active || h.pathFocused) return;
    // 충돌 대화상자가 떠 있으면 나머지 키는 삼킨다 — 뒤에서 목록이 움직이면 무엇에 답하는 중인지 흐려진다
    if (h.transfers.pending) {
      if (ev.key === "Escape") {
        ev.preventDefault();
        ev.stopPropagation();
        h.transfers.dismiss();
      }
      return;
    }
    if (h.menus.menu) return;

    // ── 파일 타일 층 단축키 ──
    // 글자 칸 위에서는 비켜 서되 이 타일의 필터 칸만 예외다(거르는 중에도 먹어야 한다). 가져간 키는 전파를 끊어 전역 리졸버가 다시 보지 않게 한다.
    const combo = comboFromEvent(ev);
    const fileAction = combo === null ? undefined : h.fileBindings.get(combo);
    if (fileAction !== undefined) {
      const inFilter = ev.target instanceof Element && ev.target.closest("[data-file-filter]") !== null;
      if ((inFilter || !isEditableTarget(ev.target)) && h.runFileAction(fileAction)) {
        ev.preventDefault();
        ev.stopPropagation();
        return;
      }
    }

    const target = ev.target as HTMLElement | null;
    const tag = target?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;
    if ((tag === "BUTTON" || tag === "A") && (ev.key === "Enter" || ev.key === " ")) return;

    // 멀티미디어 키보드의 ⏴/⏵ — 수식 키와 무관하다
    if (h.nav.tryKey(ev)) return;

    // ── Ctrl 하나짜리 A/C/X/V ── 수식 조합은 전역의 이름공간이고 여기서 가져오는 것은 이 넷뿐이다
    if ((ev.ctrlKey || ev.metaKey) && !ev.altKey && !ev.shiftKey) {
      const take = () => {
        ev.preventDefault();
        ev.stopPropagation();
      };
      const k = ev.key.toLowerCase();
      if (k === "a") {
        take();
        h.sel.all(h.order);
        return;
      }
      if (k === "c") {
        take();
        h.copySelection("copy");
        return;
      }
      if (k === "x") {
        take();
        h.copySelection("cut");
        return;
      }
      if (k === "v") {
        take();
        h.pasteInto(h.targetDir);
        return;
      }
    }

    // Shift 는 걸러 내지 않는다 — 아래 화살표의 범위 넓히기다
    if (ev.altKey || ev.ctrlKey || ev.metaKey) return;

    const extend = ev.shiftKey;

    // ── 아이콘 · 간단히 보기 — 격자 위 2차원 ── 칸 수는 타일 크기 · 크기 단계가 정해 그때마다 화면에서 잰다
    if (h.view !== "details" && isArrow(ev.key)) {
      ev.preventDefault();
      const flow: GridFlow = h.view === "icons" ? "row" : "column";
      const at = h.sel.focus === null ? -1 : h.navOrder.indexOf(h.sel.focus);
      const next = gridStep(h.navOrder.length, at, ev.key, flow, this.gridSpan(flow));
      if (next < 0) return;
      const forward = ev.key === "ArrowRight" || ev.key === "ArrowDown";
      h.sel.move(h.navOrder, at < 0 ? (forward ? 1 : -1) : next - at, extend, false);
      this.scrollToFocus();
      return;
    }

    switch (ev.key) {
      case "ArrowDown": {
        ev.preventDefault();
        // 감싸지 않는다 — 수천 줄 목록에서 끝에서 맨 위로 튀면 어디에 있었는지 감각이 끊긴다
        h.sel.move(h.navOrder, 1, extend, false);
        this.scrollToFocus();
        return;
      }
      case "ArrowUp": {
        ev.preventDefault();
        h.sel.move(h.navOrder, -1, extend, false);
        this.scrollToFocus();
        return;
      }
      case "Home":
      case "End": {
        if (h.navOrder.length === 0) return;
        ev.preventDefault();
        h.sel.move(h.navOrder, ev.key === "Home" ? -h.navOrder.length : h.navOrder.length, extend, false);
        this.scrollToFocus();
        return;
      }
      case "ArrowRight":
      case "ArrowLeft": {
        if (!h.isTree || extend) return;
        const id = h.sel.focus;
        const row = id === null ? undefined : h.rowById.get(id);
        if (!row) return;
        ev.preventDefault();
        if (ev.key === "ArrowRight") {
          if (row.kind !== "entry" || !row.expandable) return;
          if (!row.expanded) h.listing.expand(row.entry.path);
          else {
            const child = firstChildId(h.rows, row.id);
            if (child) this.focusRow(child);
          }
        } else {
          if (row.kind === "entry" && row.expanded) h.listing.collapse(row.entry.path);
          else {
            const up = parentRowId(h.rows, row.id);
            if (up) this.focusRow(up);
          }
        }
        return;
      }
      case "Enter": {
        const aux = h.sel.focus !== null && isAuxId(h.sel.focus) ? h.rowById.get(h.sel.focus) : undefined;
        if (aux?.kind === "more") {
          ev.preventDefault();
          h.listing.showMore(aux.parent);
          return;
        }
        if (h.focusEntry) {
          ev.preventDefault();
          h.openEntry(h.focusEntry);
        }
        return;
      }
      case "Backspace": {
        // Backspace 는 "상위 폴더" 가 아니라 "뒤로" 다 — 세션 타일과 뜻을 맞춘다 (docs/log/2026-09-04-nav-history.md)
        ev.preventDefault();
        void h.nav.go(extend ? "forward" : "back");
        return;
      }
      case "F2": {
        if (h.focusEntry && !h.isRootItem(h.focusEntry.path)) {
          ev.preventDefault();
          h.menus.menu = this.rowMenuAnchor(h.focusEntry);
          void h.menus.startRename();
        }
        return;
      }
      case "Delete": {
        const list = h.targets();
        if (list.length > 0 && !list.some(h.isRootItem)) {
          ev.preventDefault();
          ev.stopPropagation();
          h.menus.menu = this.rowMenuAnchor(h.focusEntry);
          h.menus.startRemove();
        }
        return;
      }
      case "Escape": {
        if (h.sel.count > 0) {
          ev.preventDefault();
          h.sel.clear();
        }
        return;
      }
    }

    // ── 글자 쳐서 고르기 ── 공백은 이어 치는 중일 때만 글자다
    if (ev.key.length === 1 && (ev.key !== " " || this.typeAhead !== "")) {
      const next = this.typeAhead + ev.key;
      const hit = findByPrefix(h.rows, h.sel.focus, next);
      clearTimeout(this.typeAheadTimer);
      this.typeAheadTimer = setTimeout(() => (this.typeAhead = ""), TYPE_AHEAD_MS);
      this.typeAhead = next;
      if (hit) {
        ev.preventDefault();
        this.focusRow(hit);
      }
    }
  };

  focusRow = (id: string) => {
    this.#h.sel.set({ anchor: id, focus: id, ids: new Set([id]) });
    this.scrollToFocus();
  };

  rowMenuAnchor = (entry: SftpEntry | null): FileMenuAnchor => {
    const el = entry
      ? this.#h.listEl?.querySelector<HTMLElement>(`[data-path="${CSS.escape(entry.path)}"]`)
      : null;
    const box = el?.getBoundingClientRect();
    const x = Math.min(box?.left ?? 40, window.innerWidth - 230);
    const y = Math.min(box?.bottom ?? 40, window.innerHeight - 330);
    return { x: Math.max(4, x), y: Math.max(4, y), entry };
  };

  gridSpan = (flow: GridFlow): number => {
    const items = this.#h.listEl?.querySelectorAll<HTMLElement>("[data-path]");
    if (!items || items.length < 2) return 1;
    const first = items[0].getBoundingClientRect();
    let n = 0;
    for (const el of items) {
      const r = el.getBoundingClientRect();
      const same = flow === "row" ? Math.abs(r.top - first.top) < 1 : Math.abs(r.left - first.left) < 1;
      if (!same) break;
      n += 1;
    }
    return Math.max(1, n);
  };

  scrollToFocus = () => {
    const id = this.#h.sel.focus;
    if (id === null) return;
    const attr = isAuxId(id) ? "data-nav-id" : "data-path";
    const el = this.#h.listEl?.querySelector<HTMLElement>(`[${attr}="${CSS.escape(id)}"]`);
    el?.scrollIntoView({ block: "nearest", inline: "nearest" });
  };
}

function isArrow(key: string): key is ArrowKey {
  return key === "ArrowUp" || key === "ArrowDown" || key === "ArrowLeft" || key === "ArrowRight";
}
