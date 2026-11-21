// 쿼리 타일의 AI 권한 팝오버 — 원격 타일과 같은 상자(`AiPermMenu`)이고 대상은 DB 연결 하나다.
// 저장은 연결 폼과 같은 Tauri 명령(`setDbConnAi` → `db_ai_set`)뿐이고 MCP 에는 길이 없다. 확인 대화 없이 바로 바꾸고 YOLO 로 올릴 때만 확인 상자가 선다
// (행이 모델 제공자로 간다는 경고는 단계 설명 `DB_AI_DESC` 에 있다).
import { createChipMenu } from "$lib/pane/chip-menu.svelte.js";
import type { PermStageRow } from "$lib/pane/ai-perm-menu.svelte.js";
import { findDbConn } from "$lib/app/db-conns.svelte.js";
import { dbAiServerReady, dbAiViewOf, dbAiWritePlans, refreshDbAi, setDbConnAi } from "$lib/app/db-ai.svelte.js";
import { openConnForm } from "$lib/app/query.svelte.js";
import { DB_AI_DESC, DB_AI_LEVELS, DB_AI_NAME, dbAiChipOf, type DbAiLevel } from "$lib/db-ai";
import type { PaneSpec } from "$lib/session";
import type { HostBox } from "$lib/pane/boxes";
import { t as tr } from "$lib/i18n/i18n.svelte.js";

/** 허용 목록 자동 승인(Auto)은 없다 */
export const DB_STAGE_ROWS: readonly PermStageRow<DbAiLevel>[] = DB_AI_LEVELS.map((id) => ({
  id,
  name: DB_AI_NAME[id],
  desc: DB_AI_DESC[id],
}));

export function queryConnOf(pane: PaneSpec): { id: string; name: string } | null {
  if (pane.kind !== "query" || !pane.query) return null;
  const c = findDbConn(pane.query.connId);
  return c ? { id: c.id, name: c.name } : null;
}

export function queryAiOf(pane: PaneSpec): ReturnType<typeof dbAiChipOf> | null {
  const c = queryConnOf(pane);
  return c ? dbAiChipOf(dbAiViewOf(c.id)) : null;
}

/** 연결 폼과 같은 문구 */
export function dbAiMenuNotes(broken: boolean, level: DbAiLevel): string[] {
  const out: string[] = [];
  if (broken) out.push(tr("app.dbai.broken"));
  if (!dbAiServerReady()) out.push(tr("app.dbai.server.outdated"));
  else if ((level === "approve" || level === "all") && !dbAiWritePlans()) out.push(tr("app.dbai.approve.restart"));
  return out;
}

/** `AI_MENU_WIDTH` 와 같은 값 */
const DB_AI_MENU_WIDTH = 340;

export interface DbAiMenuHost {
  readonly boxes: HostBox[];
}

export class DbAiMenuController {
  #m;

  constructor(h: DbAiMenuHost) {
    this.#m = createChipMenu({
      boxes: () => h.boxes,
      width: DB_AI_MENU_WIDTH,
      canOpen: (box) => queryConnOf(box.pane) !== null,
      // 다른 창 · 폼이 바꿨을 수 있다
      onOpen: () => void refreshDbAi(),
    });
  }

  get at() {
    return this.#m.at;
  }

  get box() {
    return this.#m.box;
  }

  conn = $derived.by(() => (this.box === null ? null : queryConnOf(this.box.pane)));

  open = (box: HostBox, at: { left: number; top: number } | null) => this.#m.open(box, at);

  toggle = (ev: MouseEvent, box: HostBox) => this.#m.toggle(ev, box);

  close = (back: "none" | "back" | "trigger" = "none") => this.#m.close(back);

  /** 상자는 열어 둔 채 저장한다 — 연결은 마크업이 인자로 넘긴다 */
  pick = (conn: { id: string; name: string }, level: DbAiLevel) => setDbConnAi(conn, level);

  /** 포커스는 되돌리지 않는다 — 곧 모달이 가져간다 */
  openConnSettings = () => {
    this.#m.run((c: { id: string }) => void openConnForm({ id: c.id }), () => this.conn, "none");
  };
}
