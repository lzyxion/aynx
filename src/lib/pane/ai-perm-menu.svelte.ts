// 원격 타일의 AI 권한 팝오버 — 단계 저장·"호스트 설정 › AI" + 공용 칩 메뉴(`chip-menu.svelte.ts` — 여닫기·자리·토글·
// 포커스 되돌리기·`runOnMenu` 통로) 위의 얇은 설정(별칭 없는 타일에는 열지 않는다).
// `PaneHost` 가 옛 상태 자리에서 하나 만들고 마크업(`AiPermMenu`)·머리줄 칩·⋯ 메뉴의 "AI 권한…" 이 부른다. `$effect` 없음.
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

/**
 * 권한 팝오버(`AiPermMenu`)의 단계 하나 — 원격(호스트 단계)과 쿼리 타일(DB 단계)이 같은 모양으로 넘긴다. 팝오버는 이것을 게이지
 * (`AiGauge` 좁은 꼴, 10-23)의 자리 다섯으로 그린다 — 눈금 · 말풍선 · aria 는 `name`(모든 언어에서 같은 짧은 영어 낱말 — 10-23), 아래 한 줄은 `desc`.
 */
export interface PermStageRow<S extends string = string> {
  id: S;
  name: Key;
  desc: Key;
}

/** 원격 타일의 단계 다섯(Off · Read · Ask · Auto · YOLO) */
export const HOST_STAGE_ROWS: readonly PermStageRow<AiStage>[] = AI_STAGES.map((id) => ({
  id,
  name: AI_STAGE_NAME[id],
  desc: AI_STAGE_DESC[id],
}));

/** 컨트롤러가 `PaneHost` 에서 읽는 것 — 게터라 그때그때의 값이다 */
export interface AiPermMenuHost {
  readonly boxes: HostBox[];
}

// ---------------------------------------------------------------------------
// AI 권한 팝오버 (2026-10-07 — 원격 세션의 AI 권한 = 호스트 하나의 단계)
//
// 입구가 둘이다: **머리줄의 권한 칩**(`toggleAiMenu` — 10-23 부터 끔이어도 선다 · 별칭 없는 타일은 흐린 Off 칩)과 ⋯ 메뉴의
// "AI 권한…"(`openAiMenu` — 끔일 때도 이 길로 켠다). 상자·몸짓은 tmux 팝오버와 같은 규칙이고
// (`tmux-menu.svelte.ts`), 다른 것은 안에 든 것이 **고르는 즉시 저장되는 컨트롤**이라는 점이다:
// 단계 라디오·헤드리스 토글은 상자를 닫지 않고 그 자리에서 `delegation_set_target` 을 부른다
// (닫지 않으므로 통로를 지날 일이 없다 — 별칭은 마크업이 **인자로** 넘긴다). 상자를 닫고 다른 화면을
// 여는 줄("호스트 설정 › AI")만 `runOnMenu` 통로(스냅샷 → 닫기 → 실행)를 지난다.
// ---------------------------------------------------------------------------

/** 팝오버 폭 상한 — 화면 오른쪽으로 넘치지 않게 잡는 데 쓴다 (`TMUX_MENU_WIDTH` 와 같은 처방) */
const AI_MENU_WIDTH = 340;

export class AiPermMenuController {
  #m;

  constructor(h: AiPermMenuHost) {
    this.#m = createChipMenu({
      boxes: () => h.boxes,
      width: AI_MENU_WIDTH,
      // 별칭이 없는 타일(빠른 접속)에는 열지 않는다 — ⋯ 메뉴의 줄은 이미 흐려 있다
      canOpen: (box) => aiHostAlias(box.pane) !== null,
    });
  }

  /** 열려 있으면 자리와 대상 타일 id */
  get aiMenu() {
    return this.#m.at;
  }

  /** 팝오버가 가리키는 타일 (닫혔거나 다른 창으로 갔으면 `null` — 팝오버도 함께 닫힌다) */
  get aiBox() {
    return this.#m.box;
  }

  /** 그 타일의 호스트 별칭 (호스트 목록에 없는 타일이면 `null` — 그런 타일에는 애초에 열리지 않는다) */
  aiAlias = $derived.by(() => (this.aiBox === null ? null : aiHostAlias(this.aiBox.pane)));

  /** 연다. `at` 은 부른 쪽이 준 자리 — ⋯ 메뉴가 서 있던 자리이거나 머리줄 칩의 바로 아래다 */
  openAiMenu = (box: HostBox, at: { left: number; top: number } | null) => this.#m.open(box, at);

  /** 머리줄 칩 — 이미 이 타일의 팝오버가 열려 있으면 닫는다 (tmux 칩과 같은 토글 · `data-ai-menu-btn`) */
  toggleAiMenu = (ev: MouseEvent, box: HostBox) => this.#m.toggle(ev, box);

  /** 닫는다 — `"none"`(바깥 클릭·창 크기 변경)이면 포커스를 되돌리지 않는다 (⋯ 메뉴와 같은 규칙) */
  closeAiMenu = (back: "none" | "back" | "trigger" = "none") => this.#m.close(back);

  /**
   * 이 창에서 **같은 호스트를 문 타일 수** — 부제("이 호스트의 타일 N개와 헤드리스 세션에…")의 N.
   * 창 하나만 센다(다른 창의 타일은 이 창이 모른다) — 바꾸면 그 창들도 `delegation-changed` 로 따라온다.
   */
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

  /** 단계 하나를 고른다 — 상자는 열어 둔 채 곧바로 저장. 실패는 한 줄로 말한다(사람이 누른 일이다) */
  pickStage = async (alias: string, stage: AiStage) => {
    try {
      await setHostAiStage(alias, stage);
    } catch (e) {
      showNotice(tr("pane.aiperm.failed", { error: e instanceof Error ? e.message : String(e) }));
    }
  };

  /** 헤드리스 접속 토글 — 단계가 승인 후 실행 아래면 마크업이 이미 재워 둔다 */
  setHeadless = async (alias: string, on: boolean) => {
    try {
      await setHostHeadlessConnect(alias, on);
    } catch (e) {
      showNotice(tr("pane.aiperm.failed", { error: e instanceof Error ? e.message : String(e) }));
    }
  };

  /**
   * "호스트 설정 › AI" — **별칭을 스냅샷하고** 닫은 뒤 호스트 폼을 AI 칸으로 연다(`runOnMenu` 통로).
   * 포커스는 되돌리지 않는다(`"none"`) — 곧 모달이 포커스를 가져간다.
   */
  openHostSettings = () => {
    this.#m.run((alias: string) => openEditByAlias(alias, "ai"), () => this.aiAlias, "none");
  };
}
