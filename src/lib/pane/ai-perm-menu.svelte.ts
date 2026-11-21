// 원격 타일의 AI 권한 팝오버 — 원격 세션의 AI 권한은 호스트 하나의 단계다. 별칭 없는 타일(빠른 접속)에는 열지 않는다.
import { createChipMenu } from "$lib/pane/chip-menu.svelte.js";
import { showNotice } from "$lib/app/notice";
import { setHostAiStage, setHostHeadlessConnect } from "$lib/app/delegation.svelte.js";
import { openEditByAlias } from "$lib/app/hosts.svelte.js";
import { residentWindowTabs } from "$lib/app/tabs.svelte.js";
import { AI_STAGES, AI_STAGE_DESC, AI_STAGE_NAME, aiHostAlias, type AiStage } from "$lib/delegation";
import { listPanes } from "$lib/session";
import type { HostBox } from "$lib/pane/boxes";
import { t as tr } from "$lib/i18n/i18n.svelte.js";
import type { Key } from "$lib/i18n/keys";

/** 원격(호스트 단계)과 쿼리 타일(DB 단계)이 같은 모양으로 넘긴다 */
export interface PermStageRow<S extends string = string> {
  id: S;
  name: Key;
  desc: Key;
}

export const HOST_STAGE_ROWS: readonly PermStageRow<AiStage>[] = AI_STAGES.map((id) => ({
  id,
  name: AI_STAGE_NAME[id],
  desc: AI_STAGE_DESC[id],
}));

export interface AiPermMenuHost {
  readonly boxes: HostBox[];
}

// 단계 · 헤드리스 토글은 상자를 닫지 않고 그 자리에서 저장한다(별칭은 마크업이 인자로 넘긴다).
// 상자를 닫고 다른 화면을 여는 줄("호스트 설정 › AI")만 `runOnMenu` 통로(스냅샷 → 닫기 → 실행)를 지난다.

const AI_MENU_WIDTH = 340;

export class AiPermMenuController {
  #m;

  constructor(h: AiPermMenuHost) {
    this.#m = createChipMenu({
      boxes: () => h.boxes,
      width: AI_MENU_WIDTH,
      canOpen: (box) => aiHostAlias(box.pane) !== null,
    });
  }

  get aiMenu() {
    return this.#m.at;
  }

  get aiBox() {
    return this.#m.box;
  }

  aiAlias = $derived.by(() => (this.aiBox === null ? null : aiHostAlias(this.aiBox.pane)));

  openAiMenu = (box: HostBox, at: { left: number; top: number } | null) => this.#m.open(box, at);

  toggleAiMenu = (ev: MouseEvent, box: HostBox) => this.#m.toggle(ev, box);

  closeAiMenu = (back: "none" | "back" | "trigger" = "none") => this.#m.close(back);

  /** 이 창의 타일만 센다 — 다른 창은 `delegation-changed` 로 따라온다 */
  tileCount = (alias: string): number => {
    const key = alias.toLowerCase();
    let n = 0;
    for (const tab of residentWindowTabs()) {
      for (const pane of listPanes(tab.root)) {
        if (aiHostAlias(pane)?.toLowerCase() === key) n += 1;
      }
    }
    return n;
  };

  pickStage = async (alias: string, stage: AiStage) => {
    try {
      await setHostAiStage(alias, stage);
    } catch (e) {
      showNotice(tr("pane.aiperm.failed", { error: e instanceof Error ? e.message : String(e) }));
    }
  };

  setHeadless = async (alias: string, on: boolean) => {
    try {
      await setHostHeadlessConnect(alias, on);
    } catch (e) {
      showNotice(tr("pane.aiperm.failed", { error: e instanceof Error ? e.message : String(e) }));
    }
  };

  /** 포커스는 되돌리지 않는다 — 곧 모달이 가져간다 */
  openHostSettings = () => {
    this.#m.run((alias: string) => openEditByAlias(alias, "ai"), () => this.aiAlias, "none");
  };
}
