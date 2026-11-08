// 타일의 tmux 세션 팝오버 — 이 타일에서 전환 + 공용 칩 메뉴(`chip-menu.svelte.ts` — 여닫기·자리·토글·포커스 되돌리기·
// 줄 실행 `runOnMenu` 통로) 위의 얇은 설정.
// `PaneHost` 가 옛 상태 자리에서 하나 만들고 마크업(`TmuxMenu`)과 ⋯ 메뉴의 "tmux 세션…" 이 부른다. `$effect` 없음.
import { createChipMenu } from "$lib/pane/chip-menu.svelte.js";
import { showNotice } from "$lib/app/notice";
import { askConfirm } from "$lib/app/confirm-dialog.svelte.js";
import { killTmuxSession, switchTmuxSession, tmuxKillPrompt, type TmuxSessionInfo } from "$lib/tmux";
import type { HostBox } from "$lib/pane/boxes";
import type { PaneHostProps } from "$lib/pane/props";
import { t as tr } from "$lib/i18n/i18n.svelte.js";

/** 컨트롤러가 `PaneHost` 에서 읽는 것 — 전부 게터라 그때그때의 값이다 */
export interface TmuxMenuHost {
  readonly boxes: HostBox[];
  readonly sessionOf: PaneHostProps["sessionOf"];
  readonly ontmux: PaneHostProps["ontmux"];
}

// ---------------------------------------------------------------------------
// tmux 세션 팝오버 (docs/log/2026-09-16-tmux-toggle.md)
//
// 입구가 둘이다. **주 입구는 머리줄의 tmux 칩**(`toggleTmuxMenu`)이고, ⋯ 메뉴의
// "tmux 세션…"(`runMenuAction`)은 `[app] tile_header` 로 머리줄을 끈 사람의 길로 남는다.
// 둘의 차이는 **자리를 어디서 얻느냐** 하나뿐이다: 칩은 자기 사각형 아래, ⋯ 쪽은 메뉴가
// 서 있던 자리(닫히기 전에 스냅샷한 좌표). 상자·몸짓은 ⋯ 메뉴와 같은 규칙이고(그래서
// `TmuxMenu` 가 `PaneMenu` 의 토큰을 그대로 쓴다), 여기 남는 것도 같은 셋뿐이다:
// 어디에 열지 · 무엇을 대상으로 할지 · 누른 줄을 어느 길로 잇는지.
// ---------------------------------------------------------------------------

/** 팝오버 폭 상한 — 화면 오른쪽으로 넘치지 않게 잡는 데 쓴다 (`TILE_MENU_WIDTH` 와 같은 처방) */
const TMUX_MENU_WIDTH = 320;

export class TmuxMenuController {
  #h: TmuxMenuHost;
  #m;

  constructor(h: TmuxMenuHost) {
    this.#h = h;
    this.#m = createChipMenu({ boxes: () => h.boxes, width: TMUX_MENU_WIDTH });
  }

  /** 열려 있으면 자리와 대상 타일 id */
  get tmuxMenu() {
    return this.#m.at;
  }

  /** 팝오버가 가리키는 타일 (닫혔거나 다른 창으로 갔으면 `null` — 팝오버도 함께 닫힌다) */
  get tmuxBox() {
    return this.#m.box;
  }

  /**
   * 목록을 연다. `at` 은 **부른 쪽이 준 자리**다 — ⋯ 메뉴가 서 있던 자리이거나, 머리줄 tmux 칩의 바로 아래다.
   * 여기서 잡는 넘침은 **가로뿐이다**(팝오버가 ⋯ 메뉴보다 넓다). 세로는 `TmuxMenu` 자신이 붙고 나서 잰다.
   */
  openTmuxMenu = (box: HostBox, at: { left: number; top: number } | null) => this.#m.open(box, at);

  /**
   * **머리줄의 tmux 칩** — 목록의 주 입구다. 이미 이 타일의 목록이 열려 있으면 닫는다(칩의 `data-tmux-menu-btn` 덕에
   * `TmuxMenu` 의 "바깥 누름으로 닫기" 가 이 버튼만 비켜 간다). 자리는 **칩의 왼쪽 변을 맞춘 바로 아래**다
   * (⋯ 메뉴가 오른쪽 변을 맞추는 것과 반대 — 칩은 머리줄 한가운데쯤에 있고 팝오버는 오른쪽으로 펼 자리가 남는다).
   */
  toggleTmuxMenu = (ev: MouseEvent, box: HostBox) => this.#m.toggle(ev, box);

  /** 닫는다. `"none"`(바깥 클릭·창 크기 변경)에서는 포커스를 되돌리지 않는다 (⋯ 메뉴와 같은 규칙) */
  closeTmuxMenu = (back: "none" | "back" | "trigger" = "none") => this.#m.close(back);

  /**
   * 줄 하나 — **대상을 스냅샷하고** 닫은 뒤 실행한다 (`runTileMenu` 와 같은 통로 규칙).
   * 고른 세션 이름은 마크업이 **인자로** 넘긴다: 그 값은 닫히면 사라지는 목록에서 왔다.
   */
  runTmuxMenu = (fn: (box: HostBox) => void) => this.#m.run(fn);

  /**
   * **이 타일에서 전환** — 붙어 있는 tmux 클라이언트에게 `switch-client` 한 줄을 쓴다.
   *
   * 화면이 그 자리에서 바뀌므로 타일이 물고 있는 이름도 함께 옮겨 적는다(`ontmux`) — 그래야
   * **다음 접속이 그 세션으로 돌아간다**(`PaneSpec.tmux` 가 곧 재접속 힌트다). 순서가 중요하다:
   * 쓰기가 실패하면 화면은 그대로이므로 이름도 바꾸지 않는다.
   */
  switchTmuxIn = async (box: HostBox, name: string) => {
    const id = this.#h.sessionOf?.(box.pane.id) ?? null;
    if (id === null) {
      showNotice(tr("pane.tmux.no_session"));
      return;
    }
    try {
      await switchTmuxSession(id, name, tr);
    } catch (e) {
      showNotice(
        tr("pane.tmux.switch.failed", {
          reason: e instanceof Error ? e.message : String(e),
        }),
      );
      return;
    }
    this.#h.ontmux?.(box.pane.id, name);
  };

  /**
   * 줄 끝의 **끄기 단추** — 다른 줄 단추와 같은 통로(`runOnMenu`: 스냅샷 → 닫기 → 실행)를 지난다. 열어 둔 채 확인 대화를 띄우지
   * 않는 이유: 대화의 단추를 누르는 pointerdown 이 팝오버의 "바깥 누름으로 닫기" 에 걸려 그 순간 목록이 사라지고, 목록이 쥔
   * 다시 읽기(세대 번호)도 함께 버려진다. 그래서 닫고 → 묻고 → 끄고 → **같은 자리에 다시 연다** — 다시 열린 팝오버가 뜨는 순간
   * 목록을 새로 읽는다(그 결과가 칩 호버 카드의 값도 갈아 끼운다 — `noteTmuxSessions`). 자리는 닫히기 전에 스냅샷한다.
   */
  killTmuxFromMenu = (s: TmuxSessionInfo) => {
    const at = this.#m.at;
    const spot = at === null ? null : { left: at.left, top: at.top };
    this.#m.run((box) => void this.killTmuxIn(box, s, spot));
  };

  /**
   * 확인 → `ssh_tmux_kill` → 목록 다시 열기. **이 타일이 붙어 있는 세션**(`PaneSpec.tmux`)이면 확인 글이 그 사실을 먼저 말하고
   * (`tmuxKillPrompt`), 꺼지면 이 타일의 tmux 클라이언트 · 셸도 끝나므로 목록을 다시 열지 않는다. 취소 · 실패면 다시 연다
   * (보던 목록으로 돌아간다 — 실패는 알림 한 줄).
   */
  killTmuxIn = async (box: HostBox, s: TmuxSessionInfo, spot: { left: number; top: number } | null) => {
    const id = this.#h.sessionOf?.(box.pane.id) ?? null;
    if (id === null) {
      showNotice(tr("pane.tmux.no_session"));
      return;
    }
    const here = s.name === (box.pane.tmux ?? null);
    const p = tmuxKillPrompt(s, here, tr);
    const ok = await askConfirm(p.body, {
      title: p.title,
      kind: "warning",
      danger: true,
      okLabel: p.okLabel,
      points: p.points,
    });
    let killed = false;
    if (ok) {
      try {
        await killTmuxSession(id, s.name);
        killed = true;
      } catch (e) {
        showNotice(tr("pane.tmux.kill.failed", { reason: e instanceof Error ? e.message : String(e) }));
      }
    }
    if (killed && here) return;
    // 그 사이 다른 팝오버가 열렸거나 타일이 사라졌으면 다시 열지 않는다.
    const again = this.#h.boxes.find((b) => b.pane.id === box.pane.id);
    if (again && this.#m.at === null) this.#m.open(again, spot);
  };
}
