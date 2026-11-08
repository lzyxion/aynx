// 쿼리 타일의 AI 권한 팝오버(10-14) — 원격 타일의 것(`ai-perm-menu.svelte.ts`)과 **같은 상자**(`AiPermMenu`) · 같은 공용 칩 메뉴
// (`chip-menu.svelte.ts` — 여닫기 · 자리 · 토글 · 포커스 되돌리기 · `runOnMenu` 통로) 위의 얇은 설정. 대상은 호스트가 아니라 **DB 연결 하나**다.
// `PaneHost` 가 하나 만들고 마크업(`AiPermMenu`) · 머리줄 칩 · ⋯ 메뉴의 "AI 권한…" 이 부른다. `$effect` 없음.
//
// 저장은 `setDbConnAi`(3a 의 Tauri 명령 `db_ai_set` — 폼과 같은 명령, `delegation.toml` `[[database]]` + 신원 스냅샷은 Rust 가 적는다).
// 고르면 **확인 대화 없이 바로** 바꾼다(10-15 — 행이 모델 제공자로 간다는 경고는 단계 줄 설명 `DB_AI_DESC` 에 있다) — YOLO(10-23)로 올릴 때만
// 확인 상자가 먼저 선다(`setDbConnAi`). 새 저장 길은 없고 MCP 에도 없다.
// 단계는 앱의 사본(`app/db-ai.svelte.ts`)에서 읽으므로 칩 · 독 · 폼 · 설정 › 보안 표가 함께 바뀐다.
import { createChipMenu } from "$lib/pane/chip-menu.svelte.js";
import type { PermStageRow } from "$lib/pane/ai-perm-menu.svelte.js";
import { findDbConn } from "$lib/app/db-conns.svelte.js";
import { dbAiServerReady, dbAiViewOf, dbAiWritePlans, refreshDbAi, setDbConnAi } from "$lib/app/db-ai.svelte.js";
import { openConnForm } from "$lib/app/query.svelte.js";
import { DB_AI_DESC, DB_AI_LEVELS, DB_AI_NAME, dbAiChipOf, type DbAiLevel } from "$lib/db-ai";
import type { PaneSpec } from "$lib/session";
import type { HostBox } from "$lib/pane/boxes";
import { t as tr } from "$lib/i18n/i18n.svelte.js";

/** 쿼리 타일의 단계 줄 다섯(Off · Schema · Read · Ask · YOLO — 허용 목록 자동 승인(Auto)은 없다) */
export const DB_STAGE_ROWS: readonly PermStageRow<DbAiLevel>[] = DB_AI_LEVELS.map((id) => ({
  id,
  name: DB_AI_NAME[id],
  desc: DB_AI_DESC[id],
}));

/** 이 타일이 가리키는 DB 연결(쿼리 타일이 아니거나 목록에 없으면 `null`) */
export function queryConnOf(pane: PaneSpec): { id: string; name: string } | null {
  if (pane.kind !== "query" || !pane.query) return null;
  const c = findDbConn(pane.query.connId);
  return c ? { id: c.id, name: c.name } : null;
}

/** 머리줄 칩 · 팝오버에 걸 지금 상태 — 연결이 목록에 없으면 `null`(칩도 ⋯ 메뉴 줄도 서지 않거나 흐리다) */
export function queryAiOf(pane: PaneSpec): ReturnType<typeof dbAiChipOf> | null {
  const c = queryConnOf(pane);
  return c ? dbAiChipOf(dbAiViewOf(c.id)) : null;
}

/** 팝오버 안내 줄 — 연결 폼과 **같은 문구**(풀림 · 이전 판 세션 서버) */
export function dbAiMenuNotes(broken: boolean, level: DbAiLevel): string[] {
  const out: string[] = [];
  if (broken) out.push(tr("app.dbai.broken"));
  if (!dbAiServerReady()) out.push(tr("app.dbai.server.outdated"));
  else if ((level === "approve" || level === "all") && !dbAiWritePlans()) out.push(tr("app.dbai.approve.restart"));
  return out;
}

/** 팝오버 폭 상한 — `AI_MENU_WIDTH` 와 같은 값 */
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
      // 연결이 목록에 없는 쿼리 타일(지워진 연결)에는 열지 않는다 — ⋯ 메뉴의 줄은 이미 흐려 있다
      canOpen: (box) => queryConnOf(box.pane) !== null,
      // 다른 창 · 폼이 바꿨을 수 있다 — 뜰 때 한 번 새로 읽는다
      onOpen: () => void refreshDbAi(),
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

  /** 그 타일의 연결(이름 · id) */
  conn = $derived.by(() => (this.box === null ? null : queryConnOf(this.box.pane)));

  open = (box: HostBox, at: { left: number; top: number } | null) => this.#m.open(box, at);

  /** 머리줄 칩 — 이미 이 타일의 팝오버가 열려 있으면 닫는다(`data-ai-menu-btn`) */
  toggle = (ev: MouseEvent, box: HostBox) => this.#m.toggle(ev, box);

  close = (back: "none" | "back" | "trigger" = "none") => this.#m.close(back);

  /**
   * 단계 하나를 고른다 — 상자는 열어 둔 채(원격 팝오버와 같은 몸짓) `setDbConnAi` 로 바로 저장한다(실패 문구까지 그쪽 — 성공 토스트 · 확인 대화 없음, 원격 팝오버와 같다).
   * 연결은 마크업이 **인자로** 넘긴다.
   */
  pick = (conn: { id: string; name: string }, level: DbAiLevel) => setDbConnAi(conn, level);

  /**
   * "DB 연결 설정" — **연결을 스냅샷하고** 닫은 뒤 연결 폼을 연다(`runOnMenu` 통로 — 독 DB 우클릭의 편집과 같은 폼).
   * 포커스는 되돌리지 않는다(`"none"`) — 곧 모달이 포커스를 가져간다.
   */
  openConnSettings = () => {
    this.#m.run((c: { id: string }) => void openConnForm({ id: c.id }), () => this.conn, "none");
  };
}
