// 타일의 tmux 세션 팝오버 (docs/log/2026-09-16-tmux-toggle.md) — 공용 칩 메뉴(`chip-menu.svelte.ts`) 위의 얇은 설정.
import { createChipMenu } from "$lib/pane/chip-menu.svelte.js";
import { showNotice } from "$lib/app/notice";
import { askConfirm } from "$lib/app/confirm-dialog.svelte.js";
import { killTmuxSession, switchTmuxSession, tmuxKillPrompt, type TmuxSessionInfo } from "$lib/tmux";
import type { HostBox } from "$lib/pane/boxes";
import type { PaneHostProps } from "$lib/pane/props";
import { t as tr } from "$lib/i18n/i18n.svelte.js";

/** 전부 게터라 그때그때의 값이다 */
export interface TmuxMenuHost {
  readonly boxes: HostBox[];
  readonly sessionOf: PaneHostProps["sessionOf"];
  readonly ontmux: PaneHostProps["ontmux"];
}

const TMUX_MENU_WIDTH = 320;

export class TmuxMenuController {
  #h: TmuxMenuHost;
  #m;

  constructor(h: TmuxMenuHost) {
    this.#h = h;
    this.#m = createChipMenu({ boxes: () => h.boxes, width: TMUX_MENU_WIDTH });
  }

  get tmuxMenu() {
    return this.#m.at;
  }

  get tmuxBox() {
    return this.#m.box;
  }

  openTmuxMenu = (box: HostBox, at: { left: number; top: number } | null) => this.#m.open(box, at);

  toggleTmuxMenu = (ev: MouseEvent, box: HostBox) => this.#m.toggle(ev, box);

  closeTmuxMenu = (back: "none" | "back" | "trigger" = "none") => this.#m.close(back);

  /** 고른 세션 이름은 마크업이 인자로 넘긴다 — 그 값은 닫히면 사라지는 목록에서 왔다 */
  runTmuxMenu = (fn: (box: HostBox) => void) => this.#m.run(fn);

  /** 쓰기가 성공한 뒤에만 이름을 옮겨 적는다(`ontmux`) — `PaneSpec.tmux` 가 다음 접속의 힌트다 */
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
   * 열어 둔 채 확인 대화를 띄우지 않는다 — 대화 단추의 pointerdown 이 "바깥 누름으로 닫기" 에 걸려 목록과 그 다시 읽기가 버려진다.
   * 닫고 → 묻고 → 끄고 → 같은 자리에 다시 연다(자리는 닫히기 전에 뜬다).
   */
  killTmuxFromMenu = (s: TmuxSessionInfo) => {
    const at = this.#m.at;
    const spot = at === null ? null : { left: at.left, top: at.top };
    this.#m.run((box) => void this.killTmuxIn(box, s, spot));
  };

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
    if (killed && here) return; // 이 타일의 tmux 클라이언트 · 셸도 끝났다
    // 그 사이 다른 팝오버가 열렸거나 타일이 사라졌으면 다시 열지 않는다.
    const again = this.#h.boxes.find((b) => b.pane.id === box.pane.id);
    if (again && this.#m.at === null) this.#m.open(again, spot);
  };
}
