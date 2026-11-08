// 파일 타일의 키보드 — 창 전역 keydown(`active` 로 거른다) · 파일 타일 층 단축키(`keybindings.ts` 의 `files` 층) ·
// 선택·클립보드 조합 · 화살표/Home/End · 트리 → ← · Enter·Backspace·F2·Delete·Escape · 글자 쳐서 고르기.
// `SftpBrowser.svelte` 가 옛 자리에서 하나 만들고 `<svelte:window onkeydown>` 에 건다. 글자 시계를 거두는 `$effect` 는
// `SftpBrowser` 에 남는다.
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

/** 키보드가 타일에서 읽고 부르는 것 — 전부 게터라 그때그때의 값이다 */
export interface FileKeysHost {
  /** 이 타일이 지금 보이는 활성 타일인가 */
  readonly active: boolean;
  /** 경로 칸에 포커스가 있는가 */
  readonly pathFocused: boolean;
  /** 파일 타일 층의 `조합 → 액션 id` (사용자 오버라이드를 지난 것) */
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
  /** 지금 보기 — 아이콘·간단히는 화살표가 2차원으로 걷는다 */
  readonly view: FileView;
  readonly focusEntry: SftpEntry | null;
  readonly targetDir: string;
  readonly listEl: HTMLDivElement | null;
  copySelection(mode: FsClipMode): void;
  pasteInto(dir: string): void;
  openEntry(entry: SftpEntry): void;
  isRootItem(path: string): boolean;
  targets(): string[];
  /** 파일 타일 층 액션 하나를 실행한다 — 모르는 id 면 `false` */
  runFileAction(id: string): boolean;
}

const TYPE_AHEAD_MS = 800;

export class FileKeys {
  #h: FileKeysHost;

  /** 글자 쳐서 고르기 — 이어 친 글자와 그것을 비울 시계 (화면이 읽지 않으므로 `$state` 가 아니다) */
  typeAhead = "";
  typeAheadTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(h: FileKeysHost) {
    this.#h = h;
  }

  /**
   * 목록의 키 조작.
   *
   * **창 전역에서 잡고 `active` 로 거른다.** 목록 컨테이너에 걸지 않는 이유는 그것이
   * 포커스를 받을 수 없는 `<div>` 라 키 이벤트가 애초에 오지 않기 때문이다. `active` 는
   * "보이는 활성 타일" 이라 창에 하나뿐이므로 타일 여럿이 같은 키를 두고 다투지 않는다.
   *
   * 세 가지를 비켜 간다: **메뉴가 열려 있을 때**(그때는 메뉴가 주인이다), **경로 칸에
   * 포커스가 있을 때**, 그리고 그 밖의 입력 요소 위. 마지막 것은 `menu` 검사와 겹치지만,
   * 새 입력 칸이 늘어날 때 여기를 고치는 것을 잊어도 안전하도록 대상 자체를 본다.
   *
   * **버튼 위의 Enter·Space 도 비켜 간다** (빵부스러기·툴바). 거기서는 그 키가 버튼을
   * 누르는 키라, 여기서 또 "고른 항목 열기" 로 읽으면 한 번에 두 가지가 일어난다.
   *
   * `Alt+화살표`(타일 이동)·`Ctrl+D`(타일 닫기) 같은 전역 조합은 여기서 아무것도 하지
   * 않고 지나간다 (docs/log/2026-09-03-hosts-toolbar-tile-focus.md 의 규칙).
   */
  onKeydown = (ev: KeyboardEvent) => {
    const h = this.#h;
    if (!h.active || h.pathFocused) return;
    // 충돌 대화상자가 떠 있으면 답할 것이 그것 하나다 — Escape 는 [취소] 와 같은 뜻이고
    // 나머지 키는 통째로 삼킨다 (뒤에서 목록이 움직이면 무엇에 답하는 중인지 흐려진다).
    if (h.transfers.pending) {
      if (ev.key === "Escape") {
        ev.preventDefault();
        ev.stopPropagation();
        h.transfers.dismiss();
      }
      return;
    }
    if (h.menus.menu) return;

    // ── 파일 타일 층 단축키 (`keybindings.ts` 의 `files` 층 — 보기 · 경로 · 필터 · 장소) ──────────
    //
    // 글자를 치는 칸 위에서는 비켜 선다 — **이 타일의 필터 칸만 예외**다(거르는 중에도 `Ctrl+L`·`F9`·보기 바꾸기가
    // 먹어야 하고, 그 칸은 `Ctrl+…`·`F9` 에 아무 뜻을 두지 않는다). 가져간 키는 전파를 끊어 전역 리졸버가 다시
    // 보지 않게 한다(두 층은 한 이름공간이라 기본값끼리는 겹치지 않는다 — `sharesKeys`).
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

    // 멀티미디어 키보드의 전용 ⏴/⏵ — **수식 키와 무관하게** 언제나 뒤로/앞으로다.
    if (h.nav.tryKey(ev)) return;

    // ── Ctrl 하나짜리 조합 — 선택·클립보드 (세션 타일과 같은 규칙) ─────────────
    //
    // 수식 조합은 원래 통째로 전역의 이름공간이다. 여기서 가져오는 것은 **Ctrl(⌘) 하나만
    // 붙은 A/C/X/V** 넷뿐인데, 전역 바인딩은 관례상 `Ctrl+Shift+…`·`Alt+…` 이고 이 넷은
    // 어느 탐색기에서나 같은 뜻이라 자리마다 뜻이 달라지는 문제가 없다. 가져간 키는
    // 전파도 끊어 전역 리졸버가 다시 해석하지 않게 한다.
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
        // 대상은 **대상 폴더** — 들어가기 보기는 지금 폴더, 트리는 고른 줄의 폴더(`targetDir`)
        h.pasteInto(h.targetDir);
        return;
      }
    }

    // 나머지 수식 조합은 이 탐색기의 것이 아니다 — 전부 앱 전역의 이름공간이다
    // (Shift 는 예외다: 아래 화살표의 "범위 넓히기" 라 여기서 걸러 내면 안 된다).
    if (ev.altKey || ev.ctrlKey || ev.metaKey) return;

    /** Shift+화살표 = 앵커에서 여기까지 범위로 넓히기 */
    const extend = ev.shiftKey;

    // ── 아이콘 · 간단히 보기 — 화살표가 **격자 위를 2차원으로** 걷는다 ────────────────────────────
    //
    // 한 줄(아이콘)·한 열(간단히)에 몇 칸이 서는지는 타일 폭·높이와 크기 단계가 정하므로 그릴 때마다 화면에서 잰다
    // ([`gridSpan`]). 규칙(줄 끝에서 다음 줄로 · 짧은 마지막 줄 · 감싸지 않기)은 순수 함수 `gridStep` 하나다.
    if (h.view !== "details" && isArrow(ev.key)) {
      ev.preventDefault();
      const flow: GridFlow = h.view === "icons" ? "row" : "column";
      const at = h.sel.focus === null ? -1 : h.navOrder.indexOf(h.sel.focus);
      const next = gridStep(h.navOrder.length, at, ev.key, flow, this.gridSpan(flow));
      if (next < 0) return;
      // 커서가 없던 상태면 `moveFocus` 가 진행 방향의 첫 칸을 고른다(같은 답) — 있으면 그 차이만큼 옮긴다
      const forward = ev.key === "ArrowRight" || ev.key === "ArrowDown";
      h.sel.move(h.navOrder, at < 0 ? (forward ? 1 : -1) : next - at, extend, false);
      this.scrollToFocus();
      return;
    }

    switch (ev.key) {
      case "ArrowDown": {
        ev.preventDefault();
        // **감싸지 않는다** (세션 타일의 목록 보기와 다른 한 가지). 파일 목록은 수천 줄이
        // 흔한데 끝에서 맨 위로 튀면 어디에 있었는지 감각이 통째로 끊긴다.
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
        // 맨 위 · 맨 아래 (호스트·프로젝트 트리와 같은 키). Shift 면 거기까지 넓힌다.
        if (h.navOrder.length === 0) return;
        ev.preventDefault();
        h.sel.move(h.navOrder, ev.key === "Home" ? -h.navOrder.length : h.navOrder.length, extend, false);
        this.scrollToFocus();
        return;
      }
      case "ArrowRight":
      case "ArrowLeft": {
        // 트리 보기의 → ← (호스트·프로젝트 트리와 한 벌 — docs/log/2026-09-25-hosts-tree.md 6절).
        // 들어가기 보기에서는 뜻이 없어 그대로 흘려보낸다(예전과 같다).
        if (!h.isTree || extend) return;
        const id = h.sel.focus;
        const row = id === null ? undefined : h.rowById.get(id);
        if (!row) return;
        ev.preventDefault();
        if (ev.key === "ArrowRight") {
          // 접힌 폴더 = 펼치기 · 펼친 폴더 = 첫 아이로 · 그 밖은 할 일 없음
          if (row.kind !== "entry" || !row.expandable) return;
          if (!row.expanded) h.listing.expand(row.entry.path);
          else {
            const child = firstChildId(h.rows, row.id);
            if (child) this.focusRow(child);
          }
        } else {
          // 펼친 폴더 = 접기 · 그 밖 = 든 폴더 줄로 (뿌리 바로 아래면 할 일 없음)
          if (row.kind === "entry" && row.expanded) h.listing.collapse(row.entry.path);
          else {
            const up = parentRowId(h.rows, row.id);
            if (up) this.focusRow(up);
          }
        }
        return;
      }
      case "Enter": {
        // "N개 더 보기" 에 앉아 있으면 그것을 누른다
        const aux = h.sel.focus !== null && isAuxId(h.sel.focus) ? h.rowById.get(h.sel.focus) : undefined;
        if (aux?.kind === "more") {
          ev.preventDefault();
          h.listing.showMore(aux.parent);
          return;
        }
        // 폴더 = **들어가기**(뿌리를 그 폴더로 — 트리에서도 같다), 파일 = 열기
        if (h.focusEntry) {
          ev.preventDefault();
          h.openEntry(h.focusEntry);
        }
        return;
      }
      case "Backspace": {
        // **Backspace 는 "뒤로" 다** (예전에는 "상위 폴더" 였다 —
        // docs/log/2026-09-04-nav-history.md). 브라우저·탐색기의 관례이고, 세션 타일과
        // 뜻을 하나로 맞추기 위해서다. 상위로 가는 길은 툴바 ↑ 가 그대로 들고 있다.
        ev.preventDefault();
        void h.nav.go(extend ? "forward" : "back");
        return;
      }
      case "F2": {
        // 이름 변경은 언제나 **하나**에 대한 조작이라 커서가 앉은 줄이 대상이다.
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

    // ── 글자 쳐서 고르기 (type-to-select) ────────────────────────────────────
    //
    // 수식 없는 글자 하나 — 이름이 그 글자(들)로 시작하는 줄로 커서를 옮긴다(탐색기·VS Code 의 관례).
    // 잠깐(`TYPE_AHEAD_MS`) 안에 이어 친 글자는 붙여서 찾는다. 공백은 이어 치는 중일 때만 글자다.
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

  /** 줄 하나만 골라 커서를 앉히고 화면 안으로 */
  focusRow = (id: string) => {
    this.#h.sel.set({ anchor: id, focus: id, ids: new Set([id]) });
    this.scrollToFocus();
  };

  /**
   * 키보드로 연 메뉴(F2·Delete)를 **그 줄 위에** 띄우기 위한 좌표. 마우스가 없으므로
   * 줄의 DOM 위치를 읽는다 — 화면 구석에 뜨면 무엇에 대한 메뉴인지 알 수 없다.
   */
  rowMenuAnchor = (entry: SftpEntry | null): FileMenuAnchor => {
    const el = entry
      ? this.#h.listEl?.querySelector<HTMLElement>(`[data-path="${CSS.escape(entry.path)}"]`)
      : null;
    const box = el?.getBoundingClientRect();
    const x = Math.min(box?.left ?? 40, window.innerWidth - 230);
    const y = Math.min(box?.bottom ?? 40, window.innerHeight - 330);
    return { x: Math.max(4, x), y: Math.max(4, y), entry };
  };

  /**
   * 격자 한 줄(`row` — 아이콘 보기)·한 열(`column` — 간단히 보기)의 **칸 수**를 화면에서 잰다 — 첫 칸과 같은
   * 높이(줄)·같은 x(열)에 선 칸을 센다. 칸이 하나뿐이면 1.
   */
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

  /** 커서가 앉은 줄을 화면 안으로 (키보드 이동이 목록 밖으로 나가지 않게) */
  scrollToFocus = () => {
    const id = this.#h.sel.focus;
    if (id === null) return;
    // 항목 줄은 `data-path`, "N개 더 보기" 곁줄은 `data-nav-id` 를 단다 (마퀴는 앞의 것만 센다)
    const attr = isAuxId(id) ? "data-nav-id" : "data-path";
    const el = this.#h.listEl?.querySelector<HTMLElement>(`[${attr}="${CSS.escape(id)}"]`);
    el?.scrollIntoView({ block: "nearest", inline: "nearest" });
  };
}

/** 화살표 넷 중 하나인가 */
function isArrow(key: string): key is ArrowKey {
  return key === "ArrowUp" || key === "ArrowDown" || key === "ArrowLeft" || key === "ArrowRight";
}
