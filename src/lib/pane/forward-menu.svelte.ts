// 타일의 포워딩 목록 메뉴 — 공용 칩 메뉴(`chip-menu.svelte.ts` — 여닫기·자리·토글·포커스 되돌리기·줄 실행 `runOnMenu` 통로)
// 위의 얇은 설정(열 때 목록 새로 읽기). 2026-10-11, tmux 팝오버(`tmux-menu.svelte.ts`)와 같은 판이다. `PaneHost` 가 옛 상태 자리에서 하나 만들고 마크업(`ForwardMenu`)·머리줄 포워딩 칩·⋯ 메뉴의 "포트 포워딩…" 이 부른다.
// `$effect` 없음.
import { createChipMenu } from "$lib/pane/chip-menu.svelte.js";
import { reloadPaneForwards } from "$lib/app/forwards.svelte.js";
import type { HostBox } from "$lib/pane/boxes";
import type { ForwardInfo } from "$lib/forward";

/** 포워딩 칩 호버 카드 한 장 — 머리줄이 짓고 `PaneHost` 가 타일 상자 밖에서 그린다 (`TmuxCardView` 와 같은 판) */
export interface ForwardsCardView {
  /** 이 타일의 세션에 살아 있는 포워드들 (칩과 같은 값) */
  forwards: ForwardInfo[];
  /** 칩의 상자 (뷰포트 좌표) */
  anchor: { left: number; top: number; width: number; height: number };
}

/** 컨트롤러가 `PaneHost` 에서 읽는 것 — 게터라 그때그때의 값이다 */
export interface ForwardMenuHost {
  readonly boxes: HostBox[];
}

/** 메뉴 폭 상한 — 화면 오른쪽으로 넘치지 않게 잡는 데 쓴다 (`TMUX_MENU_WIDTH` 와 같은 처방, 줄이 길어 조금 넓다) */
const FORWARD_MENU_WIDTH = 400;

// ---------------------------------------------------------------------------
// 입구가 둘이다 — tmux 팝오버와 같은 짝. **주 입구는 머리줄의 포워딩 칩**(`toggleForwardMenu` — 칩 왼쪽 변 바로 아래)이고,
// ⋯ 메뉴의 "포트 포워딩…" 은 `[app] tile_header` 로 머리줄을 끈 사람의 길이다(그 메뉴가 서 있던 자리 — 포워드가 0개면
// 메뉴 대신 추가 모달로 곧장 간다: `PaneHost.runMenuAction`). 목록의 값은 칩과 같은 표(`app/forwards` 의
// `forwardsOf`)이고, 뜨는 순간 한 번 새로 읽는다(`reloadPaneForwards` — 칩 표는 5초 주기라 연결 수가 낡았을 수 있다).
// ---------------------------------------------------------------------------

export class ForwardMenuController {
  #m;

  constructor(h: ForwardMenuHost) {
    this.#m = createChipMenu({
      boxes: () => h.boxes,
      width: FORWARD_MENU_WIDTH,
      onOpen: (box) => void reloadPaneForwards(box.pane.id),
    });
  }

  /** 열려 있으면 자리와 대상 타일 id */
  get forwardMenu() {
    return this.#m.at;
  }

  /** 메뉴가 가리키는 타일 (닫혔거나 다른 창으로 갔으면 `null` — 메뉴도 함께 닫힌다) */
  get forwardBox() {
    return this.#m.box;
  }

  /** 목록을 연다 — `at` 은 부른 쪽이 준 자리(칩 아래 · ⋯ 메뉴 자리). 뜨는 순간 목록을 한 번 새로 읽는다. 세로 넘침은 `ForwardMenu` 자신이 잰다 */
  openForwardMenu = (box: HostBox, at: { left: number; top: number } | null) => this.#m.open(box, at);

  /**
   * **머리줄의 포워딩 칩** — 이미 이 타일의 목록이 열려 있으면 닫는다(토글). 칩의 `data-forward-chip` 덕에
   * `ForwardMenu` 의 "바깥 누름으로 닫기" 가 이 칩만 비켜 간다(`toggleTmuxMenu` 와 같은 이유).
   */
  toggleForwardMenu = (ev: MouseEvent, box: HostBox) => this.#m.toggle(ev, box);

  /** 닫는다. `"none"`(바깥 클릭·창 크기 변경)이면 포커스를 되돌리지 않는다 (⋯ 메뉴와 같은 규칙) */
  closeForwardMenu = (back: "none" | "back" | "trigger" = "none") => this.#m.close(back);

  /**
   * 줄 하나 — **대상 타일을 스냅샷하고** 닫은 뒤 실행한다 (`runTmuxMenu` 와 같은 통로 규칙, docs/conventions.md).
   * 고른 포워드(id · 주소)는 마크업이 **인자로** 넘긴다: 그 값은 닫히면 사라지는 목록에서 왔다.
   */
  runForwardMenu = (fn: (box: HostBox) => void) => this.#m.run(fn);
}
