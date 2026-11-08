// 로컬 타일의 AI 권한 팝오버(10-23 — 사용자 결정 A: 예전 "AI 읽기 허용" 토글 · "AI 읽기" 칩을 원격과 **같은 칩 · 같은 상자**로).
// 상자는 `AiPermMenu`(게이지 좁은 꼴)이고 단계 줄은 원격과 같은 다섯(Off · Read · Ask · Auto · YOLO)이되 **Off · Read 만** 고른다 —
// Ask 부터는 잠김(`LOCAL_LOCKED_FROM`): 로컬 타일은 AI 실행 대상이 아니다(작업안 대상이 되지 않는다 — CLAUDE.md 보안 제약).
// 저장은 예전 그대로 타일별 읽기 허용(`ai.svelte.ts` 의 공유 집합 → `Terminal.svelte` 가 세션 메타 `set_session_ai_read` 로 메아리)이다 —
// 새 저장 길 · 새 명령은 없다. 원격 창에서 켤 때는 마스터를 다시 확인한다(R1a-4 — 예전 ⋯ 메뉴 토글과 같다 · 끄기는 묻지 않는다).
// 단계 줄 · 잠김 자리 · 고르기는 순수한 짝 `local-ai.ts`.
// `PaneHost` 가 하나 만들고 마크업(`AiPermMenu`) · 머리줄 칩 · ⋯ 메뉴의 "AI 권한…" 이 부른다. `$effect` 없음. 상자를 닫는 줄이 없어
// `runOnMenu` 통로를 지날 일이 없다(고르면 상자는 열어 둔 채 그 자리에서 바뀐다 — 원격 팝오버와 같은 몸짓).
import { createChipMenu } from "$lib/pane/chip-menu.svelte.js";
import { pickLocalAi } from "$lib/pane/local-ai";
import type { AiStage } from "$lib/delegation";
import { localAiTile } from "$lib/app/delegation.svelte.js";
import type { HostBox } from "$lib/pane/boxes";

/** 팝오버 폭 상한 — `AI_MENU_WIDTH` 와 같은 값 */
const LOCAL_AI_MENU_WIDTH = 340;

export interface LocalAiMenuHost {
  readonly boxes: HostBox[];
}

export class LocalAiMenuController {
  #m;

  constructor(h: LocalAiMenuHost) {
    this.#m = createChipMenu({
      boxes: () => h.boxes,
      width: LOCAL_AI_MENU_WIDTH,
      // 로컬 AI CLI 타일에는 AI 읽기 권한이 없다(10-23) — 팝오버도 열리지 않는다
      canOpen: (box) => box.pane.kind === "local" && !localAiTile(box.pane),
    });
  }

  /** 열려 있으면 자리와 대상 타일 id */
  get at() {
    return this.#m.at;
  }

  /** 팝오버가 가리키는 타일 */
  get box() {
    return this.#m.box;
  }

  open = (box: HostBox, at: { left: number; top: number } | null) => this.#m.open(box, at);

  /** 머리줄 칩 — 이미 이 타일의 팝오버가 열려 있으면 닫는다(`data-ai-menu-btn`) */
  toggle = (ev: MouseEvent, box: HostBox) => this.#m.toggle(ev, box);

  close = (back: "none" | "back" | "trigger" = "none") => this.#m.close(back);

  /** 단계 하나를 고른다 — 상자는 열어 둔 채(`pickLocalAi` — `local-ai.ts`). 타일 id 는 마크업이 **인자로** 넘긴다 */
  pick = (paneId: string, stage: AiStage): void => pickLocalAi(paneId, stage);
}
