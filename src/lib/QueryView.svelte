<script lang="ts">
  import { onDestroy, onMount, setContext, tick, untrack } from "svelte";
  import { GRID_TILE_MENU, type GridTileMenu } from "$lib/query/grid-menu";
  import { listen, type UnlistenFn } from "./ipc";
  import { openFindZoneIn, registerTileFind } from "$lib/app/tile-find";
  import UiIcon from "$lib/UiIcon.svelte";
  import Keys from "$lib/Keys.svelte";
  import SqlEditor from "$lib/query/SqlEditor.svelte";
  import RunResults, { type RunShown } from "$lib/query/RunResults.svelte";
  import RowLimit, { type RowLimitProps } from "$lib/query/RowLimit.svelte";
  import RunBar from "$lib/query/RunBar.svelte";
  import ScriptTabs from "$lib/query/ScriptTabs.svelte";
  import SchemaTree from "$lib/query/SchemaTree.svelte";
  import SchemaPane from "$lib/query/SchemaPane.svelte";
  import DefinitionView from "$lib/query/DefinitionView.svelte";
  import DataTab from "$lib/query/DataTab.svelte";
  import { dataSelectSql, pageSizeOf } from "$lib/query/data-tab";
  import TreeMenu from "$lib/query/TreeMenu.svelte";
  import ScriptTabMenu from "$lib/query/ScriptTabMenu.svelte";
  import { sqlDropAccepts, sqlSaveName } from "$lib/query/sql-file";
  import { dropSources, openSqlSources, pickSqlSources, saveSqlText } from "$lib/query/sql-file-io";
  import { sameTarget } from "$lib/query/definition";
  import type { Load, TreeRelation } from "$lib/query/schema-tree";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { paneHeadShown, setPaneTools } from "$lib/pane/pane-tools.svelte.js";
  import { stripReason } from "$lib/error-reason";
  import { QUERY_ROW_LIMITS, QUERY_ROWS_DEFAULT, paneName, type PaneSpec, type QueryRowLimit } from "$lib/session";
  import { selectStarSql } from "$lib/query/sql-quote";
  import { createSqlCompleter } from "$lib/query/sql-completer";
  import { createScriptTabs, docKey } from "$lib/query/script-controller.svelte.js";
  import { createQuerySession } from "$lib/query/query-session.svelte.js";
  import {
    dbDefinition,
    errorMessage,
    type DbDefinition,
    type DbDefinitionTarget,
    type DbDialect,
    type DbTxView,
  } from "$lib/query/query-backend";
  import { formatClock, txOpen } from "$lib/query/tx-work";
  import { chipText, fitRunLine, type ChipParts } from "$lib/query/bar-fit";
  import { queryTreeLayout, TREE_DROP_W } from "$lib/pane/head-span";
  import { DROPDOWN_GAP, DROPDOWN_MARGIN } from "$lib/dropdown";
  import { noteDbTx } from "$lib/app/db-tx";
  import { noteQueryLive } from "$lib/app/query-live.svelte.js";
  import { noteQueryMaxRows, noteQueryName, openConnForm, queryConnLabel, queryStreamOf } from "$lib/app/query.svelte.js";
  import type { DbEngine } from "$lib/db-conn";
  import { askAiWithText } from "$lib/app/ask-ai.svelte.js";
  import { buildDbAskText, dbAskSummary } from "$lib/query/ask-ai-db";
  import { dbAiLevelOf } from "$lib/app/db-ai.svelte.js";
  import { findDbConn } from "$lib/app/db-conns.svelte.js";
  import { comboFromEvent, effectiveCombo, resolveBindings } from "$lib/keybindings";
  import { settings } from "$lib/settings.svelte.js";
  import { toast } from "$lib/toast.svelte.js";

  /**
   * **쿼리 타일의 몸통** (`kind:"query"` — 쿼리 타일 6단계, docs/log/2026-10-12-query-tile.md).
   *
   * 배치(10-14 Beekeeper Studio 식 개편 — 목업 `Main` · `Success`): 왼쪽 스키마 트리(접기 · 폭 끌기 — 좁은 타일이면 저절로 접힘) · 오른쪽
   * 위부터 **탭 줄**(트리 여닫기 · 스크립트 탭 [쿼리 1 ●] [쿼리 2] [+] · 오른쪽 끝 연결 상태 점) · SQL 편집기 · **실행 줄**
   * (쓰기 알약 · 커밋 방식 · 작업 단추 · 작업 상태 · AI 에 묻기 · [스크립트 실행] · [실행]) · 결과 칸(높이 끌기). 머리줄의 이름 · 아이콘은 타일
   * 머리줄(`paneName` · `PaneIcon`)이 그린다.
   *
   * 연결 · 결과 · 알림 · 실행 · 쓰기 토글 · 커밋 방식 · 트랜잭션 작업의 상태와 동작은 `query/query-session.svelte.ts`(2026-10-27 분할 10차 —
   * `createQuerySession`), 스크립트 탭은 `query/script-controller.svelte.ts` 다. 아래 절의 규칙은 그대로이고 효과 · 리스너 · 수명은 여기다.
   *
   * ## 스크립트 탭(10-14 — 규칙은 `query/script-tabs`, 저장 모양은 `session/spec` 의 `canonQueryTabs`)
   *
   * 탭은 **편집기 글만** 가른다 — 편집기는 하나이고 탭을 바꾸면 글을 바꿔 끼운다(`SqlEditor.switchTo` — 탭마다 되돌리기 기록 · 커서 ·
   * 거터 표시가 따로). **결과는 탭마다 따로**(`outcomes` — 탭을 바꾸면 그 탭의 마지막 결과 · 거터 표시가 보인다 · 저장하지 않는다).
   * **연결 · 쓰기 모드 · 자동 커밋 · 트랜잭션 작업은 연결 하나에 하나**라 모든 탭이 같이 쓰고, 실행 줄의 상태 표시는 탭을 바꿔도 같다.
   * 도는 실행도 연결에 하나다(서버는 연결당 쿼리 하나) — 다른 탭에서 [취소] 할 수 있고, 결과는 실행을 보낸 탭에 내린다.
   * ● = 저장 안 된 변경(살아 있는 글이 명세의 초안과 다르다 — 디바운스 중 · 32 KiB 초과). 추가 [+] · `Ctrl+T`, 닫기 × · 가운데 누르기 ·
   * `Ctrl+W`(마지막 하나는 못 닫음 · 글이 있으면 OS 확인), 이름 두 번 누르기 · `F2`, 순서는 끌기. `Ctrl+T`/`Ctrl+W` 는 **이 타일에 포커스가
   * 있을 때만**이고, 사용자가 같은 조합을 전역 단축키에 묶었으면 전역이 이긴다(앱 기본 전역은 `Ctrl+Shift+T`/`W` 라 겹치지 않는다).
   *
   * ## 데이터 탭(2026-11-10 — Beekeeper Studio 식 · 규칙 `query/data-tab` · 그림 `query/DataTab.svelte`)
   *
   * 트리의 테이블 · 뷰 · 파티션 줄을 **한 번 누르면 고르기만**(펼치기 · 초점 — 편집기 글은 그대로), **두 번 누르기 · Enter · 우클릭 "데이터
   * 보기"** 면 그 객체의 데이터 탭을 스크립트 탭 줄에 연다(객체 하나에 탭 하나 — 있으면 그 탭으로 · 미리 보기 탭 없음). 예전 한 번 누르기
   * (지금 탭 글을 `SELECT * … LIMIT 100;` 으로 바꿈)는 우클릭 "SELECT 문 넣기" 로 남았다. 데이터 탭이 보이는 동안 편집기 · 실행 줄 · 결과
   * 칸은 숨고(편집기는 산 채 — 탭마다 되돌리기 기록 그대로) 데이터 탭이 그 자리를 채운다. 조회는 세션의 실행 칸 하나를 함께 쓰고
   * (`ses.runData` — 연결당 하나 · [취소] · 막힘이 실행과 같다) **늘 읽기 전용**(`db_query{readOnly}` — 서버가 가드 · 엔진 모두, 열린 작업이면
   * 거절)이다. 한 번 본 데이터 탭은 숨어도 산다(쪽 · 결과 유지) — 닫으면 사라진다. 조건(WHERE · 정렬 · 쪽 크기)만 명세에 남는다.
   * 결과 표의 외래 키 ↗ 는 참조 표의 데이터 탭을 그 값의 조건으로 연다(`sc.openDataWhere` — 이미 열렸으면 조건을 덮고 `poke` 로 다시 읽게).
   * 데이터 탭이 표 구조를 읽는 동안(`dataMeta`)은 트리 · 다른 데이터 탭이 기다린다(서버는 연결당 작업 하나).
   *
   * ## 수명(9단계 — 서버 `db::table` 머리말의 표)
   *
   * - 뜰 때(마운트 · 페이지 리로드 뒤 · 앱을 다시 켜 워크스페이스가 복원된 뒤 · 다른 창으로 옮겨 온 뒤) `db_open(stream, 참조)` —
   *   `stream` 은 이 타일의 영속 키(`tileKey`)라 같은 열쇠로 다시 열면 서버가 떼어 둔(10분) 연결에 다시 붙인다(`reattached`,
   *   임대 회차 +1 · 비밀번호 다시 안 물음). 탭 · 초안은 타일 명세(`pane.query`)에서 그대로 온다.
   * - 사라질 때 — 타일 닫기는 `db_close(handle, lease)`(임대를 실어 보내므로, 다른 창이 먼저 다시 붙었으면 서버가 낡은 임대로 보고
   *   닫지 않는다). **다른 창으로 옮기기(이관 — `isHandoff`)는 닫지 않는다** — 받는 창이 같은 열쇠로 다시 붙고 이 창의 임대는 낡는다
   *   (도는 쿼리만 취소한다 — 받는 창의 첫 실행이 "실행 중" 에 막히지 않게). 페이지 리로드는 컴포넌트 정리가 돌지 않는다(서버가 떼어 둔다).
   * - 떼어 둔 연결이 TTL 을 넘겨 닫혔으면 `[session-gone]` → [다시 열기](비밀번호는 볼트에 있으면 저절로, 없으면 접속 모달).
   * - `[stale-lease]`·`[session-gone]` 이면 [다시 열기] · `[server-outdated]` 면 서버 다시 시작 안내(문구는 Rust 의 것).
   * - 여는 길은 `openDbForTile`(7단계 — 볼트 관문 → 경유 SSH 관문 → `[db-password]`·`[db-auth]` 면 DB 접속 모달 → 인증 뒤 저장).
   *   모달을 취소하면 "연결 안 됨 · [다시 연결]".
   * - 서버 이벤트 `db-state`(이 타일의 `stream` · `disconnected` — 전송로 사망 · 서버가 끊음) · 쿼리의 `[db-disconnected]` 면
   *   "연결이 끊겼습니다 · [다시 연결]"(다시 열기는 새 연결 — 서버가 끊긴 연결에 다시 붙지 않는다). **이 띠만 탭 줄 아래에 남는다** —
   *   그 밖의 알림은 모두 결과 칸 머리 줄이다(아래 "알림").
   * - **끊긴 뒤에도 마지막 손잡이 · 임대(`lost`)를 기억한다** — 서버 표에는 끊긴 항목이 남아 있다([다시 연결] 의 `db_open` 이
   *   같은 열쇠의 끊긴 항목을 거둔다). 그대로 타일을 닫으면 그 손잡이로 `db_close` 를 보낸다(10-13 실기: 끊긴 타일을 닫아도 서버 표가
   *   안 비었다). 임대를 실어 보내므로 다른 창이 먼저 다시 붙었으면 서버가 낡은 임대로 보고 닫지 않는다(평소 닫기와 같은 규칙).
   *
   * ## 쓰기 토글(10단계)
   *
   * 실행 줄 맨 왼쪽 알약을 누르면 확인 대화(`askDbWrite` → `dialogs/DbWriteDialog`) 뒤 `db_set_write(true)`, 다시 누르면 묻지 않고 끈다
   * (서버가 열려 있던 트랜잭션을 되감는다). 쓰기 상태는 명세에 저장하지 않는다 — 화면은 서버의 답(`opened.writable`)만 본다: 새 연결은
   * 읽기 전용, 재부착은 서버가 쥔 그대로. 도는 쿼리가 있으면 막힌다.
   *
   * ## 실행 줄(10-14 — 편집기와 결과 사이 · 접기는 `query/bar-fit`)
   *
   * 맨 왼쪽은 늘 쓰기 알약(`[읽기 전용 / 쓰기 켬]` — 좁으면 자물쇠만), 그 뒤 쓰기 모드에서만 `[자동 | 수동 커밋]`(두 칸 전환 단추 — `role="radiogroup"`, 판 13 서버 · 규칙 `query/auto-commit`, 작업이 열려
   * 있으면 바꿀 수 없다 — 흐리게 + 말풍선) · `[시작] [커밋] [되돌리기]`(판 9 서버 — 작업 없음: [시작] 만, 작업 중: [커밋] · [되돌리기] 만
   * 누를 수 있다) · 작업 상태(`● 트랜잭션 · N문장 · 00:42`, 1분 전 경고면 `--warn` 으로 `00:59 뒤 되돌림 · N문장` + [연장]). 읽기 전용이면
   * 이 셋은 숨는다. 오른쪽 끝은 AI 에 묻기 · 경과 · `[스크립트 실행]` · `[실행]`(도는 동안 [취소]).
   *
   * ## 트랜잭션 작업(1단계 — 규칙은 `query/tx-work`, 상태 · 시계는 세션 서버 `db::tx`)
   *
   * [시작] → 문장은 지금처럼 하나씩(작업 id 를 싣는다 — 서버가 다른 작업이면 `[db-tx-stale]`) → 실행 줄 상태 + [커밋] · [되돌리기]. 끝나면
   * 결과 칸 머리 줄에 알림(커밋됨 · 되돌림은 다음 실행에서 걷히고, 오류로 되돌려짐 · 결과 불명 · 끊김 · 방치 되돌림은 닫을 때까지 남는다).
   * 작업 중 쓰기 끄기는 확인 뒤 서버가 되돌린다. 열린 작업은 `app/db-tx` 에 적어 두어 타일 · 탭 · 보조 창 닫기가 한 번 묻는다. 다시
   * 붙으면(`opened.tx`) 상태가 돌아오고, 이관이면 도는 문장을 끊지 않는다(끊으면 그 실행이 되돌려진다). 판 8 서버(`opened.tx` 없음)에서는
   * 작업 단추를 숨긴다. 작업 안의 실행 한 번은 세이브포인트 하나다(10-14 — 실패하면 그 실행만 되돌리고 작업은 이어진다 · 세 엔진 공통).
   * 수동 커밋(자동 커밋 끔)이면 데이터를 바꾸는 문장이 작업을 저절로 열고, 끈 동안(또는 작업 중) 여러 문장을 골라 `Ctrl+Enter` 하면
   * 스크립트 실행기로 간다(한 번의 실행 = 세이브포인트 하나 · 커밋 안 함).
   *
   * ## 알림 — 결과 칸 한 곳(10-14)
   *
   * 실행 결과 · 오류 · "이번 실행만 되돌림" · `[db-needs-work]` 안내 · 결과 불명은 결과 칸의 **요약 줄**(`RunResults`), 작업 종료 사유(커밋됨 ·
   * 되돌림 · 방치 되돌림 · 끊김 · 결과 불명)처럼 결과가 없는 사건은 그 위의 **알림 줄**(`notes` — 탭마다)이다. 어느 탭에 내리나:
   * **실행의 답이 실어 온 사건은 그 실행을 보낸 탭**(그 탭의 결과와 함께 읽힌다), **그 밖의 연결 사건**(서버 이벤트의 방치 되돌림 ·
   * 끊김 · [커밋] · [되돌리기] 의 답)은 **그 순간 보고 있는 탭**이다 — 작업은 연결에 하나라 어느 탭의 것도 아니고, 사람이 지금 보는 곳에
   * 서야 놓치지 않는다. [시작] 은 모든 탭의 알림을 걷고, 실행을 시작하면 조용한 알림(커밋됨 · 되돌림)만 걷는다.
   *
   * ## 실행
   *
   * `Ctrl+Enter`(편집기 안) · [실행] — 선택 영역이 있으면 그것, 없으면 커서의 문장(`statement-at` — 서버 가드와 같은 렉서, 최종 판정은
   * 서버). 도는 동안 실행 단추는 [취소](`Esc` 도), 경과 시간이 흐르고, 스키마 트리 · 두 번째 실행은 막힌다(서버는 연결당 쿼리 하나).
   * 결과는 **문장별 결과 패널**(`query/RunResults` · 규칙 `query/run-panel` — 단문은 한 줄짜리)과 **편집기 거터 표시**(✓ 남음 · ↶ 되돌려짐
   * · ✕ 실패 · · 실행 안 함 · ? 결과 불명 + 아주 연한 줄 바탕 · 실패 물결 밑줄과 말풍선 — 단문의 성공은 거터 ✓ 만). 거터는 보낸 뒤 글이
   * 그대로일 때만 칠하고, 글을 고치거나 다시 실행하면 지운다.
   *
   * ## 스크립트 실행(2단계 — 규칙은 `query/script-run`, 실행기는 세션 서버 `db::script`)
   *
   * [스크립트 실행] · `Alt+X`(편집기 안 — DBeaver 관례) — 선택 영역, 없으면 편집기 글 전체를 **한 요청**으로 보낸다. 서버가 나누고 전부
   * 검사한 뒤 한 트랜잭션으로 돈다(쓰기 = 첫 오류에서 전부 되돌림 · 모두 성공하면 커밋, 읽기 전용 = `READ ONLY` 하나 · 늘 되돌림,
   * 작업 중 = 그 작업 안 · 커밋 안 함). 멈춘 문장은 편집기에서 골라 준다(보낸 뒤 글이 그대로일 때만). 도는 동안 [실행] 이 [취소] 가
   * 되고 취소는 스크립트 전체를 되돌린다. F5 · 크래시 · 앱 종료로 화면이 사라져도 서버가 끝까지 끝내거나 되돌리고, 다시 붙으면
   * 요약(`opened.lastScript`)을 지금 탭에 한 번 보인다. 판 9 서버(`opened.scripts` 없음)면 단추를 숨긴다.
   *
   * ## DDL 보기(10-13 — 읽고 이해 O, 관리 · 변경 X)
   *
   * 트리 잎의 우클릭 "DDL 보기"(`TreeMenu` — 타일 컨테이너 밖에 그린다) · 트리 포커스의 `F4` → `db_definition` → 아래 칸이
   * **[결과 | DDL]** 둘로 갈린다(정의를 한 번 열면 전환 띠가 서고, ×로 정의를 닫으면 사라진다). 정의는 읽기 전용 편집기
   * (`query/DefinitionView`)에 보이고 [복사] · [편집기에 넣기](지금 탭의 커서 자리 — 실행하지 않는다)뿐이다. 실행하면 결과 쪽으로 돌아온다.
   *
   * ## AI 에 묻기(쿼리 타일 3b — 글은 `query/ask-ai-db`, 받는 길은 `app/ask-ai` 의 블록 → AI 타일과 같은 몸통)
   *
   * 실행 줄의 그림 단추 · 블록 → AI 타일과 **같은 단축키**(`ask-ai-block`, 기본 `Ctrl+Shift+X` — 이 타일에 포커스가 있을 때 · diff 타일과
   * 같은 규칙이라 새 키를 만들지 않는다) — 이 연결(이름 · 엔진 · DB · `connId` · AI 권한) · 지금 탭의 SQL(선택 영역이 있으면 그것) · 그 탭의
   * 마지막 오류를 AI 타일 입력 줄에 **붙여 넣기만** 한다(Enter 없음). **결과 행의 값은 넣지 않는다**(머리말 근거는 `query/ask-ai-db`). 연결의
   * AI 권한이 끔이면 넘기지 않고 켜는 곳(독 DB 우클릭 › AI 권한 · 연결 설정)을 알린다 — 직접 켜지는 않는다.
   */
  let {
    pane,
    visible = true,
    onmenu,
  }: {
    pane: PaneSpec;
    visible?: boolean;
    /** 결과 표 칸 우클릭 — 타일 메뉴(`PaneMenu` — 문서 편집기 우클릭과 같은 상자)를 커서 자리에. 줄은 표가 짓고(`query/grid-menu.ts`) 누른 줄은 `run` 으로 */
    onmenu?: GridTileMenu;
  } = $props();
  setContext<GridTileMenu>(GRID_TILE_MENU, (x, y, menu) => onmenu?.(x, y, menu));

  // 영속 키 — 없으면(방금 연 타일) 지금 단다. 이 값이 서버 DB 연결 표의 열쇠라 리로드 뒤에도 같은 연결에 붙는다.
  // (svelte-ignore: 처음 한 번의 값만 쓴다 — 타일 수명 동안 열쇠는 바뀌지 않는다)
  // svelte-ignore state_referenced_locally
  const stream = queryStreamOf(pane);
  const spec = $derived(pane.query ?? { connId: "" });

  let engine = $state<DbEngine | null>(null);
  let disposed = false;

  // ── 스크립트 탭(10-14 — 머리말) ──────────────────────────────────────────

  // 탭 목록 · 고른 탭 · 저장 디바운스 · 고르기 · 새 탭 · 닫기 · 이름 · 끌기 · 탭 키 — `query/script-controller.svelte.ts`(2026-10-27 분할 6차).
  // 닫은 탭의 결과 · 알림 걷기(`dropResults`)는 세션 상태라 콜백으로 넘긴다(원래 자리 — 편집기 문서 버리기 뒤 · 저장 앞).
  const sc = createScriptTabs({
    get pane() {
      return pane;
    },
    stream,
    get editor() {
      return editor;
    },
    get disposed() {
      return disposed;
    },
    dropResults(n) {
      ses.dropResults(n);
    },
  });

  // ── 세션 — 연결 · 결과 · 알림 · 실행 · 쓰기 토글 · 커밋 방식 · 트랜잭션 작업(머리말) ───────────────────

  // `query/query-session.svelte.ts`(2026-10-27 분할 10차). 판정 · 규칙은 순수 모듈(`write-toggle` · `tx-work` · `auto-commit` · `script-run` ·
  // `run-panel`) 그대로이고, 효과 · 리스너 · `onMount` · `onDestroy` 는 여기(원래 자리)에서 컨트롤러를 부른다.
  const ses = createQuerySession({
    get pane() {
      return pane;
    },
    stream,
    get spec() {
      return spec;
    },
    get editor() {
      return editor;
    },
    get disposed() {
      return disposed;
    },
    get maxRows() {
      return maxRows;
    },
    sc,
    showResultTab() {
      outTab = "result";
    },
  });
  const dialect = $derived<DbDialect>(ses.opened?.dialect ?? (engine === "postgres" ? "postgres" : engine === "sqlite" || engine === null ? "sqlite" : "mysql"));

  // 전송로가 죽었다 · 서버가 끊었다(세션 서버 이벤트 — 이 타일의 열쇠만)
  let unlistenState: UnlistenFn | null = null;

  onMount(() => {
    void ses.open();
    void listen<{ stream?: string; state?: string; tx?: DbTxView }>("db-state", (ev) => {
      if (ev.payload?.stream !== stream) return;
      // 서버가 스스로 바꾼 작업 상태(1분 전 경고 · 방치 되돌림).
      if (ev.payload.state === "tx") {
        if (ses.conn.state === "open") ses.seeTx(ev.payload.tx);
        return;
      }
      if (ev.payload.state !== "disconnected") return;
      ses.lostTx();
      if (ses.conn.state === "open") ses.loseConn("disconnected", t("pane.query.disconnected"));
    }).then((u) => {
      if (disposed) u();
      else unlistenState = u;
    });
    void queryConnLabel($state.snapshot(spec)).then((l) => {
      if (disposed || !l) return;
      engine = l.engine;
      noteQueryName(pane.id, l.name);
    });
  });

  onDestroy(() => {
    disposed = true;
    unlistenState?.();
    noteDbTx(pane.id, null);
    noteQueryLive(pane.id, null);
    ses.stopTimers();
    sc.flushPending();
    ses.release();
  });

  // ── 실행 ─────────────────────────────────────────────────────────────────

  let editor = $state<ReturnType<typeof SqlEditor> | null>(null);
  let tree = $state<ReturnType<typeof SchemaTree> | null>(null);
  /** 결과 칸(아래 칸) — 포커스가 여기 있으면 `find` 는 그 결과 표의 찾기다 */
  let outEl = $state<HTMLElement | null>(null);
  /** 데이터 탭들의 칸 — 포커스가 여기 있으면 `find` 는 그 표의 찾기다 */
  let dataEl = $state<HTMLElement | null>(null);

  /**
   * `find` 액션(`Ctrl+F` · 팔레트 — `app/tile-find.ts`, 2026-10-19)의 이 타일 몫. SQL 편집기 안의 `Ctrl+F` 는 애초에 편집기가 먼저
   * 받는다(`editorOwnsKey` — CodeMirror 검색 패널, DDL 보기도 같다). 편집기 밖이면 포커스 자리로 가른다: 결과 칸이면 그 결과 표의
   * 찾기 띠(`ResultGrid` — 찾기 자리 `data-find-zone`), 그 밖이면 스키마 트리의 이름 거르기 칸. 트리도 없으면(접힘 · 연결 전) `false`
   * — 모든 터미널 검색으로 떨어진다.
   */
  function openFind(): boolean {
    const el = document.activeElement;
    if (outEl && el instanceof Element && outEl.contains(el) && openFindZoneIn(outEl)) return true;
    if (dataEl && el instanceof Element && dataEl.contains(el) && openFindZoneIn(dataEl)) return true;
    // 좁은 타일 — 사이드바가 없으니 떠 있는 트리를 열고 그 거르기 칸으로(연결 전이면 거를 트리가 없다)
    if (treeLayout.narrow) {
      if (!ses.opened) return false;
      if (!treeDrop) openTreeDrop();
      if (!treeDrop) return false;
      void tick().then(() => tree?.focusFilter());
      return true;
    }
    if (!tree) return false;
    tree.focusFilter();
    return true;
  }

  $effect(() => {
    const id = pane.id;
    return untrack(() => registerTileFind(id, openFind));
  });

  // 열린 작업의 시계(표시만 — 경고 · 되돌림은 서버 이벤트 · 몸은 `ses.syncTxClock`) · 닫기 물음의 표(`app/db-tx`).
  $effect(() => {
    ses.syncTxClock();
  });
  $effect(() => noteDbTx(pane.id, txOpen(ses.tx) ? (ses.tx?.view.statements ?? 0) : null));

  // ── 행 상한 — 타일마다 기억(`PaneSpec.query.maxRows` · 기본값이면 칸 없음) ─────────────
  // 고르개는 결과 칸 아래 줄의 [복사] 옆(10-14 — `query/RowLimit`). 결과 표가 없을 때도 같은 자리의 줄이 선다.

  const maxRows = $derived<QueryRowLimit>(pane.query?.maxRows ?? QUERY_ROWS_DEFAULT);
  // 고르개의 값은 글자다(`Dropdown` 은 `V extends string`) — 숫자로 되돌려 명세에 적는다.
  const rowItems = $derived(QUERY_ROW_LIMITS.map((n) => ({ value: String(n), label: t("pane.query.rows.option", { n: n.toLocaleString() }) })));
  function pickRows(v: string) {
    const n = Number(v);
    if ((QUERY_ROW_LIMITS as readonly number[]).includes(n)) noteQueryMaxRows(pane.id, n as QueryRowLimit);
  }
  const rowLimit = $derived<RowLimitProps>({ value: String(maxRows), options: rowItems, disabled: ses.running !== null, onchange: pickRows });

  // ── 스키마 트리 ─────────────────────────────────────────────────────────

  /** 트리에서 펼친 열쇠(스키마 · 폴더 · 관계) — 타일이 사는 동안(트리를 숨겼다 펴도 · 다시 연결해도) 남는다. 저장하지 않는다 */
  let treeExpanded = $state<string[]>([]);

  /** 트리가 서버에서 읽는 중(데이터 탭이 그 사이 조회를 미룬다 — 서버는 연결당 작업 하나) */
  let treeReading = $state(false);

  /** 데이터 탭 열기 — 두 번 누르기 · Enter · 우클릭 "데이터 보기"(객체 하나에 탭 하나 — `sc.openData`) */
  function openData(obj: TreeRelation) {
    sc.openData({ kind: obj.kind, ...(obj.schema !== null ? { schema: obj.schema } : {}), name: obj.name });
  }

  /**
   * 우클릭 "SELECT 문 넣기"(예전 한 번 누르기) — 지금 쿼리 탭의 글을 `SELECT * … LIMIT 100;` 으로 바꾼다(실행하지 않는다). 지금 탭이
   * 데이터 탭이면 새 쿼리 탭에 넣는다.
   */
  function selectInto(obj: TreeRelation) {
    const sql = selectStarSql(dialect, obj.schema, obj.name);
    if (activeData) {
      sc.openSql(sql);
      return;
    }
    if (ses.running || !editor) return;
    editor.setText(sql);
  }

  // ── 데이터 탭(머리말) ─────────────────────────────────────────────────────
  const activeData = $derived(sc.activeTab.data ?? null);
  /** 한 번 보인 데이터 탭 — 숨어도 산다(쪽 · 결과 유지). 닫힌 탭은 목록에서 빠지니 저절로 사라진다 */
  let dataSeen = $state<number[]>([]);
  $effect(() => {
    const n = sc.activeN;
    if (activeData && !untrack(() => dataSeen).includes(n)) dataSeen = [...untrack(() => dataSeen), n];
  });
  const dataTabs = $derived(sc.tabs.filter((x) => x.data && dataSeen.includes(x.n)));

  /** 함수 · 시퀀스 같은 잎 — 편집기 커서 자리에 이름만 넣는다(글을 바꿔 치우지 않는다) */
  function insertName(text: string) {
    editor?.insert(text);
  }

  function onTreeFail(message: string) {
    ses.lostIfReopen(message);
  }

  // ── DDL 보기 — 아래 칸의 [결과 | DDL] ─────────────────────────────────

  let definition = $state<{ target: DbDefinitionTarget; load: Load<DbDefinition> } | null>(null);
  let outTab = $state<"result" | "definition">("result");
  let defSeq = 0;

  async function showDefinition(target: DbDefinitionTarget) {
    const o = ses.opened;
    if (!o) return;
    outTab = "definition";
    if (definition && sameTarget(definition.target, target) && definition.load.state !== "error") return;
    // 쿼리가 도는 동안은 서버가 이 연결의 다른 작업을 받지 않는다(Busy) — 그 문구가 그대로 보인다.
    const seq = ++defSeq;
    definition = { target, load: { state: "loading" } };
    try {
      const v = await dbDefinition(o.handle, o.lease, target);
      if (!disposed && seq === defSeq) definition = { target, load: { state: "ok", value: v } };
    } catch (e) {
      const m = errorMessage(e);
      if (disposed || seq !== defSeq) return;
      if (!ses.lostIfReopen(m)) definition = { target, load: { state: "error", message: stripReason(m) } };
    }
  }

  function closeDefinition() {
    defSeq++;
    definition = null;
    outTab = "result";
  }

  let treeMenu = $state<{ target: DbDefinitionTarget; title: string; rel: TreeRelation | null; x: number; y: number } | null>(null);
  function openTreeMenu(ev: MouseEvent, target: DbDefinitionTarget, title: string, rel: TreeRelation | null) {
    treeMenu = { target, title, rel, x: ev.clientX, y: ev.clientY };
  }
  const closeTreeMenu = () => (treeMenu = null);

  // ── `.sql` 파일 열기 · 저장(2026-11-10 — 규칙 `query/sql-file` · 읽기 · 쓰기 `query/sql-file-io`) ───────────────
  // 여는 길: 끌어 놓기(OS 파일 · 파일 타일 짐) · 타일 ⋯ [SQL 파일 열기…] · `Ctrl+O` — 모두 새 스크립트 탭이고 실행하지 않는다.
  // 저장: 스크립트 탭 우클릭 [.sql 로 저장…] · `Ctrl+S` — 늘 다른 이름으로(탭은 경로를 기억하지 않는다 · 데이터 탭은 저장 없음).

  const openSqlFile = (title: string | undefined, text: string) => (disposed ? true : sc.openFile(title, text));
  async function pickSqlFiles() {
    const sources = await pickSqlSources();
    if (!disposed && sources.length > 0) await openSqlSources(sources, openSqlFile);
  }
  function saveTabSql(n: number) {
    const x = sc.tabs.find((y) => y.n === n);
    const text = sc.liveText(n);
    if (!x || text === null) return;
    void saveSqlText(sqlSaveName(sc.tabLabel(x)), text);
  }

  // 스크립트 탭 우클릭 메뉴 — `TreeMenu` 와 같이 `.query` 밖에 그린다
  let tabMenu = $state<{ n: number; title: string; data: boolean; x: number; y: number } | null>(null);
  function openTabMenu(ev: MouseEvent, n: number) {
    const x = sc.tabs.find((y) => y.n === n);
    if (!x) return;
    tabMenu = { n, title: sc.tabLabel(x), data: !!x.data, x: ev.clientX, y: ev.clientY };
  }
  const closeTabMenu = () => (tabMenu = null);

  // 끌어 놓기 — 받을 수 있는 끌기(`sqlDropAccepts` — OS 파일 · 파일 타일 짐만)일 때만 놓을 곳을 그린다. **캡처 단계**에서 받는다: 편집기
  // (CodeMirror)가 놓인 파일을 제 글에 끼워 넣기 전에. `dragover` 는 전파를 끊지 않는다 — 타일 층(`PaneHost`)이 다른 타일에 그린
  // 하이라이트를 거두게(쿼리 타일 위 OS 파일은 그 층이 양보한다 — `pane/drop-rules`). 앱의 다른 끌기는 손대지 않는다.
  let fileDrop = $state(false);
  function onFileDragOver(ev: DragEvent) {
    if (!sqlDropAccepts(ev.dataTransfer?.types)) {
      fileDrop = false;
      return;
    }
    ev.preventDefault();
    if (ev.dataTransfer) ev.dataTransfer.dropEffect = "copy";
    fileDrop = true;
  }
  function onFileDragLeave(ev: DragEvent) {
    const to = ev.relatedTarget;
    if (to instanceof Node && rootEl?.contains(to)) return;
    fileDrop = false;
  }
  function onFileDrop(ev: DragEvent) {
    fileDrop = false;
    if (!sqlDropAccepts(ev.dataTransfer?.types)) return;
    ev.preventDefault();
    ev.stopPropagation();
    const sources = dropSources(ev.dataTransfer);
    if (sources.length > 0) void openSqlSources(sources, openSqlFile);
  }

  /** 트리의 DDL 보기(`F4` · 우클릭 메뉴) — 떠 있는 트리에서 왔으면 닫고 편집기로(편집기 쪽 칸이 바뀌는 조작이다) */
  function defineFromTree(d: DbDefinitionTarget) {
    const fromDrop = treeDrop !== null;
    closeTreeDrop();
    void showDefinition(d);
    if (fromDrop) editor?.focus();
  }

  // ── 배치 — 트리 폭 · 편집기 높이(타일 메모리에만) ──────────────────────

  let width = $state(0);
  let workW = $state(0);
  let bodyH = $state(0);
  let treeW = $state(220);
  let treeOpen = $state<boolean | null>(null); // null = 자동(좁으면 접힘)
  // 사이드바의 **그려지는 상자** 하나(10-20 실기) — 몸의 `.side` 폭 · 경계선 · 머리줄 무리 폭(`span`)이 모두 이 값에서 나온다
  // (보임 · 상자 폭 · 무리 끝 x — 규칙은 `pane/head-span` 의 `queryTreeLayout`). `treeW` 는 사람이 원하는 폭이고, 타일이 좁으면 상자는 그보다 줄어든다.
  const treeLayout = $derived(queryTreeLayout({ treeOpen, width, treeW }));
  const treeShown = $derived(treeLayout.shown);

  // ── 좁은 타일의 떠 있는 스키마 트리(10-20 사용자 — 문서 타일의 좁은 목차 드롭다운과 같은 결) ──────────────
  // 좁으면(`TREE_AUTO_MIN_WIDTH` 아래) 사이드바는 늘 접히고, 토글이 트리를 토글 아래 떠 있는 패널로 연다. 닫기: 바깥 클릭(투명 백드롭) ·
  // `Esc`(거르기 칸의 `Esc` 는 칸이 먼저 받는다 — 지우기 · 트리로) · 토글 다시 누르기 · 편집기로 가는 조작(SELECT · 이름 넣기 · DDL 보기 —
  // 문서 목차가 줄을 고르면 닫는 것과 같은 자리). 펼침 · 거르기 · 새로고침 · 외래 키 따라가기 · 우클릭 메뉴는 트리 안의 조작이라 남는다.
  // 넓어지면 닫는다. 그리는 곳은 `.query` 밖(컨테이너 `qtile` 이 고정 위치의 기준이 되지 않게 — `TreeMenu` 와 같은 까닭).

  /** 떠 있는 트리의 자리(토글 아래) — `null` 이면 닫힘 */
  let treeDrop = $state<{ x: number; y: number; w: number; h: number } | null>(null);
  // 트리가 읽는 중(데이터 탭이 기다린다) — 트리가 서 있을 때만 센다(읽는 도중 숨은 트리의 값이 남아 데이터 탭이 영영 기다리지 않게)
  const treeBusyReading = $derived(treeReading && (treeShown || treeDrop !== null));
  // 데이터 탭이 표 구조(외래 키 ↗ · 구조 하위 탭)를 읽는 중 — 서버는 연결당 작업 하나라 트리 · 다른 데이터 탭이 기다린다
  let dataMeta = $state(0);

  // 편집기 자동완성(2026-11-10 — 몸은 `query/sql-completer`): 표 · 뷰는 트리가 읽은 것(`oncatalog`), 열은 처음 필요할 때 표마다 한 번.
  // 열 읽기는 연결이 한가할 때만(실행 · 작업 단추 · 모드 바꾸기 · 트리 읽기 · 데이터 탭 구조 읽기가 없을 때) 보내고, 읽는 동안은 데이터 탭의
  // 구조 읽기와 같은 셈(`dataMeta`)으로 트리 · 데이터 탭을 기다리게 한다. 실행은 그 읽기가 끝난 뒤에 보낸다(`idle` — 서버 Busy 를 피해).
  const completer = createSqlCompleter({
    dialect: () => dialect,
    conn: () => ses.opened,
    canRead: () => ses.opened !== null && ses.running === null && !ses.txBusy && !ses.switching && !treeBusyReading && dataMeta === 0,
    onread: (on) => (dataMeta = Math.max(0, dataMeta + (on ? 1 : -1))),
  });
  let treeDropButton = $state<HTMLButtonElement | null>(null);
  let rootEl = $state<HTMLDivElement | null>(null);

  function openTreeDrop() {
    const r = treeDropButton?.getBoundingClientRect();
    if (!r) return;
    const w = Math.min(TREE_DROP_W, window.innerWidth - 2 * DROPDOWN_MARGIN);
    const y = r.bottom + DROPDOWN_GAP;
    // 높이는 타일 안(타일 아래 끝까지) — 창 아래 여백도 지킨다. 줄이 몇 개든 같은 높이라 펼쳐도 상자가 튀지 않는다
    const bottom = Math.min(rootEl?.getBoundingClientRect().bottom ?? window.innerHeight, window.innerHeight - DROPDOWN_MARGIN);
    treeDrop = {
      x: Math.max(DROPDOWN_MARGIN, Math.min(r.left, window.innerWidth - w - DROPDOWN_MARGIN)),
      y,
      w,
      h: Math.max(160, Math.min(480, bottom - y - 4)),
    };
  }

  function closeTreeDrop() {
    treeDrop = null;
  }

  /** `Esc` — 닫고 토글로 돌아간다(바깥 클릭 닫기는 포커스를 옮기지 않는다) */
  function treeDropKey(ev: KeyboardEvent) {
    if (ev.key !== "Escape" || ev.defaultPrevented || ev.isComposing) return;
    ev.preventDefault();
    ev.stopPropagation();
    closeTreeDrop();
    treeDropButton?.focus();
  }

  // 떠 있는 트리는 좁은 타일의 것 — 넓어지면(사이드바가 다시 선다) 닫는다
  $effect(() => {
    if (!treeLayout.narrow) untrack(() => (treeDrop = null));
  });
  let editorPct = $state(40);

  function dragTree(ev: PointerEvent) {
    const el = ev.currentTarget as HTMLElement;
    el.setPointerCapture(ev.pointerId);
    const x0 = ev.clientX;
    const w0 = treeLayout.boxW; // 그려진 상자에서 출발한다 — 좁아서 줄어든 상자를 끌면 원하는 폭(`treeW`)이 아니라 보이는 경계가 움직여야 한다
    const move = (e: PointerEvent) => (treeW = Math.max(140, Math.min(Math.max(160, width * 0.5), w0 + e.clientX - x0)));
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  }

  function dragSplit(ev: PointerEvent) {
    const el = ev.currentTarget as HTMLElement;
    el.setPointerCapture(ev.pointerId);
    const y0 = ev.clientY;
    const p0 = editorPct;
    const move = (e: PointerEvent) => {
      if (bodyH <= 0) return;
      editorPct = Math.max(15, Math.min(85, p0 + ((e.clientY - y0) / bodyH) * 100));
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  }

  function splitKey(ev: KeyboardEvent, which: "tree" | "split") {
    const step = ev.shiftKey ? 10 : 2;
    if (which === "tree" && (ev.key === "ArrowLeft" || ev.key === "ArrowRight")) {
      ev.preventDefault();
      treeW = Math.max(140, Math.min(600, treeLayout.boxW + (ev.key === "ArrowLeft" ? -step * 5 : step * 5)));
    } else if (which === "split" && (ev.key === "ArrowUp" || ev.key === "ArrowDown")) {
      ev.preventDefault();
      editorPct = Math.max(15, Math.min(85, editorPct + (ev.key === "ArrowUp" ? -step : step)));
    }
  }

  // 방언은 MySQL · MariaDB 가 하나(`mysql`)라 MariaDB 는 서버 버전 글자(`MariaDB 11.8.9` — 서버가 `VERSION()` 으로 가른 것)로 이름을 단다.
  const engineLabel = $derived(
    ses.opened?.serverVersion?.startsWith("MariaDB")
      ? t("app.query.engine.mariadb")
      : ses.opened
        ? t(`pane.query.dialect.${ses.opened.dialect}` as "pane.query.dialect.sqlite")
        : engine
          ? t(`app.query.engine.${engine}` as "app.query.engine.sqlite")
          : "",
  );
  // 머리줄 이름 카드(엔진 · 서버 버전 · 모드 — 10-14 사용자: 위 띠의 엔진 이름을 옮겼다)가 읽는 사본(`app/query-live`).
  $effect(() => {
    noteQueryLive(pane.id, {
      state: ses.conn.state,
      serverVersion: ses.opened?.serverVersion || null,
      dialect: ses.opened?.dialect ?? null,
      writable: ses.opened?.writable === true,
      autoCommit: ses.opened?.autoCommit,
    });
  });
  const sqlLang = $derived(ses.opened ? `sql-${ses.opened.dialect}` : null);

  // 실행 줄의 접기 — 폭이 모자라면 덜 중요한 글자부터 뺀다([실행] 은 글자째 남는다 — `query/bar-fit`).
  const chipParts = $derived<ChipParts | null>(
    ses.txSupported && ses.opened && ses.chip
      ? {
          name: t("pane.query.tx.chip.name"),
          stmts: t("pane.query.tx.chip.stmts", { n: ses.chip.statements }),
          // 경고 땐 경과 대신 남은 시간(두 시각이 붙어 헷갈리지 않게 — 경과는 툴팁에)
          time: ses.chip.warn ? t("pane.query.tx.warn", { left: formatClock(ses.chip.idleLeftMs) }) : ses.chip.elapsed,
          warn: ses.chip.warn,
        }
      : null,
  );
  const fit = $derived(
    fitRunLine({
      width: workW,
      pill: ses.pill.writable ? t("pane.query.write") : t("pane.query.readOnly"),
      mode: ses.acToggle.shown
        ? {
            long: [t("pane.query.commitMode.auto"), t("pane.query.commitMode.manual")],
            short: [t("pane.query.commitMode.auto"), t("pane.query.commitMode.manual.short")],
          }
        : null,
      tx: ses.txShown
        ? { begin: t("pane.query.tx.begin.short"), commit: t("pane.query.tx.commit"), rollback: t("pane.query.tx.rollback"), working: ses.chip !== null }
        : null,
      chip: chipParts,
      extend: ses.txb.extend.shown ? t("pane.query.tx.extend") : null,
      ask: true,
      elapsed: ses.running ? "00.0s" : null,
      script: ses.scriptSupported && ses.opened ? t("pane.query.script") : null,
      run: ses.running ? t("pane.query.cancel") : t("pane.query.run"),
    }),
  );
  const chipLabel = $derived(chipParts ? chipText(chipParts, fit) : "");

  // ── AI 에 묻기(3b — 머리말) ───────────────────────────────────────────────
  let askBtn = $state<HTMLButtonElement | null>(null);
  const askLevel = $derived(dbAiLevelOf(spec.connId));
  const askCombo = $derived(effectiveCombo("ask-ai-block", settings.current.keybindings));

  /** 지금 탭의 마지막 오류 한 줄(쿼리 · 스크립트의 실패) — 없으면 `null` */
  function lastError(): string | null {
    const outcome = ses.outcome;
    if (outcome.kind === "error") return outcome.message;
    if (outcome.kind === "script") return outcome.r.failed?.message ?? outcome.r.message ?? null;
    return null;
  }

  function askAi(): void {
    const name = findDbConn(spec.connId)?.name ?? title;
    if (askLevel === "off") {
      toast.info(t("pane.query.ask.off", { name }), {
        ms: 8000,
        action: { label: t("pane.query.ask.off.open"), run: () => void openConnForm({ id: spec.connId }) },
      });
      return;
    }
    // 데이터 탭이면 그 탭의 조회 문장(조건 · 정렬 · 첫 쪽 — 결과 행은 넣지 않는다)
    const whole = activeData ? dataSelectSql(dialect, activeData, 0, pageSizeOf(activeData), false) : (editor?.getText() ?? "");
    const sel = activeData ? { from: 0, to: 0 } : (editor?.selection() ?? { from: 0, to: 0 });
    const picked = sel.to > sel.from ? whole.slice(sel.from, sel.to) : "";
    const sql = picked.trim() !== "" ? picked : whole;
    const text = buildDbAskText(
      {
        connId: spec.connId,
        connName: name,
        engine: engineLabel || (engine ?? ""),
        database: findDbConn(spec.connId)?.database ?? null,
        level: askLevel,
        sql,
        selection: picked.trim() !== "",
        error: lastError(),
      },
      t,
    );
    const r = askBtn?.getBoundingClientRect();
    const anchor = r
      ? { x: r.right, y: r.bottom + 4, align: "right" as const }
      : { x: window.innerWidth / 2 - 190, y: window.innerHeight / 3, align: "left" as const };
    askAiWithText(pane.id, text, dbAskSummary(name, sql), anchor, false);
  }

  /** 탭 단축키(`Ctrl+T` 새 탭 · `Ctrl+W` 닫기 — 머리말) — 같은 조합이 전역 단축키에 묶여 있으면 전역이 이긴다 */
  const TAB_NEW = "Ctrl+KeyT";
  const TAB_CLOSE = "Ctrl+KeyW";
  /** `.sql` 열기 · 저장(`Ctrl+O` · `Ctrl+S`) — 같은 꼴(전역이 이긴다). 브라우저 기본 동작(파일 열기 · 페이지 저장)도 여기서 끊는다 */
  const FILE_OPEN = "Ctrl+KeyO";
  const FILE_SAVE = "Ctrl+KeyS";
  const globalCombos = $derived(resolveBindings(settings.current.keybindings).global);

  /** 이 타일의 키 — 블록 → AI 타일의 단축키(`ask-ai-block`)가 여기서는 "AI 에 묻기"(diff 타일과 같은 규칙) · 탭 단축키 */
  function onTileKey(ev: KeyboardEvent): void {
    if (ev.isComposing || ev.keyCode === 229) return;
    const combo = comboFromEvent(ev);
    if (!combo) return;
    if (askCombo && combo === askCombo) {
      ev.preventDefault();
      ev.stopPropagation();
      askAi();
      return;
    }
    if ((combo === TAB_NEW || combo === TAB_CLOSE) && !globalCombos.has(combo) && sc.renaming === null) {
      ev.preventDefault();
      ev.stopPropagation();
      if (combo === TAB_NEW) sc.newTab();
      else void sc.closeTabN(sc.activeN);
      return;
    }
    // 데이터 탭이 보이는 중의 `Ctrl+S` 는 받지 않는다(창 키가 브라우저 기본 동작만 끊는다)
    if ((combo === FILE_OPEN || (combo === FILE_SAVE && !activeData)) && !globalCombos.has(combo) && sc.renaming === null) {
      ev.preventDefault();
      ev.stopPropagation();
      if (combo === FILE_OPEN) void pickSqlFiles();
      else saveTabSql(sc.activeN);
    }
  }
  const title = $derived(paneName(pane, t));
  const connLabel = $derived(
    ses.conn.state === "connecting" ? t("pane.query.state.connecting") : ses.conn.state === "open" ? t("pane.query.state.open") : t("pane.query.state.closed"),
  );
  const noteTone = $derived(
    ses.note === null
      ? null
      : ses.note.key === "pane.query.tx.ended.committed"
        ? "ok"
        : ses.note.key === "pane.query.tx.ended.rolledBack"
          ? "info"
          : "err",
  );
  const runShown = $derived<RunShown | null>(ses.outcome.kind === "result" || ses.outcome.kind === "script" || ses.outcome.kind === "error" ? ses.outcome : null);
  // 타일 제목줄 개편(2026-10-20) — 머리줄이 서 있으면 위 줄(트리 토글 · 스크립트 탭 · 연결 상태)이 머리줄로 올라가 한 줄이 된다
  // (`pane/pane-tools.svelte.ts`). 머리줄이 없으면(설정 `tile_header` · 폰) 예전처럼 몸 맨 위에 그린다.
  // 머리줄 ④판(10-20 목업 `DbTile`): 트리 토글은 이름 뒤(`tail`)이고, 사이드바가 열려 있으면 왼쪽 무리(로고 · 이름 · 토글)가 사이드바 경계까지를
  // 쥔다(`span` — 쿼리 탭이 편집기 열 위에서 시작, 끌면 함께 움직인다 · `pane/head-span`). 연결 점은 걷었다 — 연결됨 = 표시 없음 · 연결 중만
  // 로고 자리에 도는 고리(`iconBusy` — 10-20 사용자 결정) · 끊김은 몸의 배너가 말한다(로고 그대로 — 목업).
  const inHead = $derived(paneHeadShown(pane.id));
  // 토글은 늘 선다 — 넓으면 사이드바 여닫기(열려 있으면 무리 오른쪽 끝 = 사이드바 경계), 좁으면 떠 있는 트리(`treeDrop`). 몸 위 줄도 같다
  const headSpan = $derived(treeLayout.span);
  $effect(() =>
    setPaneTools(pane.id, {
      bar: queryBar,
      tail: queryToggle,
      span: () => headSpan,
      iconBusy: () => (ses.conn.state === "connecting" ? connLabel : null),
      // 타일 ⋯ 맨 위 줄 — 액션 `tool:open-sql`(통로는 `PaneHost` 의 `runTileMenu` → `runOnMenu`)
      menu: () => [{ action: "tool:open-sql", label: t("pane.query.file.open"), icon: "folder-open", hint: "Ctrl+O" }],
      run: (key) => {
        if (key === "open-sql") void pickSqlFiles();
      },
    }),
  );
</script>

<!--
  위 줄(2026-10-20 타일 제목줄 개편) — 머리줄이 서 있으면 트리 토글은 이름 뒤(`tail`), 스크립트 탭은 머리줄 가운데에 서고 연결 중은 로고 자리 고리(`iconBusy`)다(`head` = 참 ·
  `pane/pane-tools.svelte.ts`). 아니면 예전처럼 몸 맨 위에 한 줄로(토글 · 탭 · 연결 상태 점). 읽기 전용 알약 · 행 수 · 실행은 실행 줄에 그대로다.
-->
{#snippet queryToggle()}
  {@render treeToggle(true)}
{/snippet}

<!-- 트리 토글 — 머리줄 안이면 테두리 없는 아이콘 단추(`.head-btn` 결 — `inhead`), 몸 위 줄이면 예전 테두리 단추.
     좁은 타일이면 같은 자리 · 같은 그림(`side-panel`)에 ▾ 를 붙인 드롭다운 단추 — 떠 있는 트리를 연다(문서 타일의 좁은 목차 단추와 같은 결) -->
{#snippet treeToggle(head: boolean)}
  {#if treeLayout.narrow}
    <button
      type="button"
      class={head ? "tree-toggle inhead drop" : "btn icon tree-toggle drop"}
      data-head-act
      bind:this={treeDropButton}
      title={treeDrop ? t("pane.query.tree.hide") : t("pane.query.tree.show")}
      aria-label={t("pane.query.tree.drop")}
      aria-haspopup="dialog"
      aria-expanded={treeDrop !== null}
      data-query-tree-drop-toggle
      onclick={() => (treeDrop ? closeTreeDrop() : openTreeDrop())}
      ><UiIcon name="side-panel" size={head ? 14 : 13} /><UiIcon name="chevron-down" size={12} /></button
    >
  {:else}
    <button
      type="button"
      class={head ? "tree-toggle inhead" : "btn icon tree-toggle"}
      data-head-act
      aria-pressed={treeShown}
      title={treeShown ? t("pane.query.tree.hide") : t("pane.query.tree.show")}
      aria-label={treeShown ? t("pane.query.tree.hide") : t("pane.query.tree.show")}
      onclick={() => (treeOpen = !treeShown)}><UiIcon name="side-panel" size={head ? 14 : 13} /></button
    >
  {/if}
{/snippet}

{#snippet queryBar(head: boolean)}
  <!-- 탭 줄 — 트리 여닫기 · 스크립트 탭 · [+] · 연결 상태(목업의 위 줄 — 쓰기 알약은 실행 줄 맨 왼쪽).
       머리줄 안이면 트리 토글은 이름 뒤(`queryToggle` — 머리줄이 그린다)라 여기 없고, 연결 상태도 없다(연결 중은 머리줄 로고 자리의 고리 — `iconBusy`).
       포커스 밖이면 [+](`data-head-act`)는 접히고 스크립트 탭은 남는다(`pane/pane-tools.svelte.ts` "늘 보임 / 드러날 때만").
       줄 · 탭 칸의 간격이 0 이라 `--head-act-gap` 은 적지 않는다. 사이드바 경계에 맞춘 머리줄(`flush`)은 왼쪽 여백 없이 탭이 바로 선다 -->
  <ScriptTabs
    {head}
    {headSpan}
    {treeToggle}
    tabs={sc.tabs}
    activeN={sc.activeN}
    renaming={sc.renaming}
    bind:renameText={sc.renameText}
    conn={ses.conn}
    {connLabel}
    tabLabel={sc.tabLabel}
    dirtyOf={sc.dirtyOf}
    tabDragStart={sc.tabDragStart}
    tabDragOver={sc.tabDragOver}
    tabDrop={sc.tabDrop}
    pickTab={sc.pickTab}
    startRename={sc.startRename}
    endRename={sc.endRename}
    closeTabN={sc.closeTabN}
    onTabKey={sc.onTabKey}
    newTab={sc.newTab}
    tabMenu={openTabMenu}
  />
{/snippet}

<!-- data-* 는 하네스 손잡이(상태 · 다시 붙었나 · 핸들) — 값이 아니라 표식이다. keydown 은 "AI 에 묻기" · 탭 단축키(diff 타일과 같은 꼴) -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="query"
  data-query-pane={pane.id}
  data-query-state={ses.conn.state}
  data-query-reattached={ses.opened?.reattached ? "" : undefined}
  data-query-handle={ses.opened?.handle}
  bind:clientWidth={width}
  bind:this={rootEl}
  data-tile-focus
  tabindex="-1"
  onkeydown={onTileKey}
  ondragovercapture={onFileDragOver}
  ondragleave={onFileDragLeave}
  ondropcapture={onFileDrop}
>
  {#if !inHead}{@render queryBar(false)}{/if}
  {#if fileDrop}
    <!-- 놓을 곳 — 끄는 동안만(포인터를 받지 않는다) -->
    <div class="file-drop" aria-hidden="true" data-query-file-drop>
      <span class="file-drop-card">
        <span class="file-drop-main">{t("pane.query.file.drop")}</span>
        <span class="file-drop-sub">{t("pane.query.file.drop.sub")}</span>
      </span>
    </div>
  {/if}

  {#if ses.conn.state === "closed"}
    <div class="banner" role="alert" data-query-banner={ses.conn.kind}>
      <span class="msg">{ses.conn.message}</span>
      {#if ses.conn.kind !== "outdated"}
        <button type="button" class="btn" onclick={() => void ses.open()} data-query-reopen
          >{ses.conn.kind === "reopen" ? t("pane.query.reopen") : t("pane.query.reconnect")}</button
        >
      {/if}
    </div>
  {/if}

  <div class="main">
    {#if treeShown}
      <SchemaPane
        treeDrop={null}
        {treeLayout}
        opened={ses.opened}
        conn={ses.conn}
        busy={ses.running !== null || ses.txBusy || ses.switching || dataMeta > 0}
        bind:tree
        bind:treeExpanded
        bind:treeReading
        {openData}
        {insertName}
        {onTreeFail}
        {defineFromTree}
        {openTreeMenu}
        {closeTreeDrop}
        {treeDropKey}
        {dragTree}
        {splitKey}
        oncatalog={completer.note}
      />
    {/if}
    <div class="work" bind:clientHeight={bodyH} bind:clientWidth={workW}>
      <!-- 데이터 탭(머리말) — 한 번 본 것은 숨어도 산다. 보이는 동안 편집기 · 실행 줄 · 결과 칸은 숨는다(편집기는 산 채) -->
      {#if dataTabs.length > 0}
        <div class="data-tabs" class:shown={activeData !== null} bind:this={dataEl}>
          {#each dataTabs as x (x.n)}
            <div class="data-tab" class:on={x.n === sc.activeN}>
              <DataTab
                n={x.n}
                data={x.data!}
                {dialect}
                opened={ses.opened}
                visible={x.n === sc.activeN && visible}
                waiting={ses.runOff || treeBusyReading || dataMeta > 0}
                treeReading={treeBusyReading}
                inWork={txOpen(ses.tx)}
                running={ses.running?.tab === x.n}
                runData={ses.runData}
                oncancel={ses.cancel}
                onchange={(d) => sc.setData(x.n, d)}
                onopensql={sc.openSql}
                onlost={ses.lostIfReopen}
                onmeta={(on) => (dataMeta = Math.max(0, dataMeta + (on ? 1 : -1)))}
                onfollow={(f) => sc.openDataWhere({ schema: f.schema, name: f.name }, f.where)}
                onopendata={(o) => sc.openData({ kind: "table", ...(o.schema !== null ? { schema: o.schema } : {}), name: o.name })}
                poke={sc.dataPoke(x.n)}
              />
            </div>
          {/each}
        </div>
      {/if}
      <div class="ed" style:height="{editorPct}%" class:gone={activeData !== null}>
        <SqlEditor
          bind:this={editor}
          docKey={docKey(sc.activeTab.n)}
          initial={sc.activeTab.text}
          lang={sqlLang}
          onrun={() => void completer.idle().then(() => ses.run())}
          onscript={() => void completer.idle().then(() => ses.runScript())}
          oncancel={ses.cancel}
          onchange={sc.onDraft}
          complete={completer.complete}
        />
      </div>
      <!-- 실행 줄(10-14) — 편집기와 결과 사이. 끌면 편집기 높이가 바뀐다(경계는 이 줄 위 선) -->
      <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
      <div
        class="hsplit"
        class:gone={activeData !== null}
        role="separator"
        aria-orientation="horizontal"
        aria-label={t("pane.query.split.resize")}
        aria-valuemin={15}
        aria-valuemax={85}
        aria-valuenow={Math.round(editorPct)}
        tabindex="0"
        onpointerdown={dragSplit}
        onkeydown={(ev) => splitKey(ev, "split")}
      ></div>
      {#if !activeData}
      <RunBar
        pill={ses.pill}
        {fit}
        acToggle={ses.acToggle}
        txShown={ses.txShown}
        txb={ses.txb}
        txSupported={ses.txSupported}
        opened={ses.opened}
        chip={ses.chip}
        {chipLabel}
        tx={ses.tx}
        {askLevel}
        {askCombo}
        bind:askBtn
        running={ses.running}
        elapsed={ses.elapsed}
        scriptSupported={ses.scriptSupported}
        runOff={ses.runOff}
        scriptTitle={ses.scriptTitle}
        onPill={ses.onPill}
        onModeKey={ses.onModeKey}
        setAutoCommit={ses.setAutoCommit}
        txCall={ses.txCall}
        {askAi}
        runScript={() => completer.idle().then(() => ses.runScript())}
        cancel={ses.cancel}
        run={() => completer.idle().then(() => ses.run())}
      />
      {/if}
      {#if definition && !activeData}
        <div class="out-tabs" role="tablist" aria-label={t("pane.query.def.tabs")}>
          <button
            type="button"
            class="otab"
            role="tab"
            aria-selected={outTab === "result"}
            onclick={() => (outTab = "result")}
            data-query-tab="result">{t("pane.query.def.tab.result")}</button
          >
          <span class="otab-pair" class:on={outTab === "definition"}>
            <button
              type="button"
              class="otab"
              role="tab"
              aria-selected={outTab === "definition"}
              onclick={() => (outTab = "definition")}
              data-query-tab="definition">{t("pane.query.def.tab.definition")}</button
            ><button
              type="button"
              class="otab-x"
              title={t("pane.query.def.tab.close")}
              aria-label={t("pane.query.def.tab.close")}
              onclick={closeDefinition}
              data-query-def-close><UiIcon name="close" size={10} /></button
            >
          </span>
        </div>
      {/if}
      <div class="out" class:gone={activeData !== null} bind:this={outEl}>
        {#if ses.note && !(definition && outTab === "definition")}
          <!-- 결과가 없는 연결 사건(작업 종료 사유) — 결과 칸 머리 줄(머리말 "알림") -->
          <div
            class="note-line tone-{noteTone}"
            role={ses.note.level === "alert" ? "alert" : "status"}
            data-query-tx-note={ses.note.key.split(".").pop()}
          >
            <span class="note-icon" aria-hidden="true"
              ><UiIcon name={noteTone === "ok" ? "check" : noteTone === "info" ? "undo" : "alert-caution"} size={14} /></span
            >
            <span class="msg"
              >{t(ses.note.key, { n: ses.note.statements })}{#if ses.note.message}<span class="tx-why">{ses.note.message}</span>{/if}</span
            >
            <button type="button" class="btn" onclick={() => (ses.notes[sc.activeN] = null)} data-query-tx-dismiss>{t("pane.query.tx.ended.dismiss")}</button>
          </div>
        {/if}
        {#if definition && outTab === "definition"}
          {#key definition.target}
            <DefinitionView target={definition.target} {dialect} load={definition.load} oninsert={(sql) => editor?.insertBlock(sql)} />
          {/key}
        {:else if runShown}
          <RunResults
            shown={runShown}
            name={sc.tabLabel(sc.activeTab)}
            limit={rowLimit}
            begin={ses.txb.begin.shown ? { disabled: ses.txb.begin.disabled, onclick: () => void ses.txCall("begin") } : null}
            onlocate={ses.locate}
          />
        {:else if ses.outcome.kind === "cancelled"}
          <p class="out-note" data-query-cancelled>{t("pane.query.cancelled")}</p>
        {:else if ses.outcome.kind === "nothing"}
          <p class="out-note">{t("pane.query.nothing")}</p>
        {:else}
          <!-- 빈 결과 칸 — 단축키 넷(실행 · 스크립트 · 취소 · 새 탭). 정책 설명은 docs/user/query-tile.md(쓰기면 반영 시점 한 줄만) -->
          <div class="out-note hint">
            {#if ses.running?.tab === sc.activeN}
              <p>{t("pane.query.running")}</p>
            {:else}
              <p class="keys">
                <span><Keys combo="Ctrl+Enter" />{t("pane.query.run")}</span>
                <span><Keys combo="Alt+X" />{t("pane.query.script")}</span>
                <span><Keys combo="Esc" />{t("pane.query.cancel")}</span>
                <span><Keys combo="Ctrl+T" />{t("pane.query.tab.add")}</span>
              </p>
            {/if}
            {#if txOpen(ses.tx) || ses.opened?.writable}
              <p class="safety on">
                {txOpen(ses.tx) ? t("pane.query.tx.hint") : ses.acOff ? t("pane.query.autoCommit.hint") : t("pane.query.write.hint")}
              </p>
            {/if}
          </div>
        {/if}
      </div>
      <!-- 결과 패널이 없을 때(실행 전 · 취소 · 할 것 없음)도 행 상한은 바꿀 수 있다 — 결과 패널은 자기 아래 줄에 그린다 -->
      {#if !(definition && outTab === "definition") && !runShown && !activeData}
        <RowLimit {...rowLimit} line />
      {/if}
    </div>
  </div>
</div>

<!-- 좁은 타일의 떠 있는 스키마 트리 — `.query` 밖(우클릭 메뉴와 같은 까닭). 우클릭 메뉴(`TreeMenu` — z 40/41)가 이 위에 뜬다 -->
{#if treeDrop}
  <SchemaPane
    {treeDrop}
    {treeLayout}
    opened={ses.opened}
    conn={ses.conn}
    busy={ses.running !== null || ses.txBusy || ses.switching || dataMeta > 0}
    bind:tree
    bind:treeExpanded
    bind:treeReading
    {openData}
    {insertName}
    {onTreeFail}
    {defineFromTree}
    {openTreeMenu}
    {closeTreeDrop}
    {treeDropKey}
    {dragTree}
    {splitKey}
    oncatalog={completer.note}
  />
{/if}

<!-- 트리의 우클릭 메뉴 — 고정 위치가 타일 컨테이너(`container: qtile`)에 갇히지 않게 `.query` 밖에 그린다 -->
{#if treeMenu}
  <TreeMenu
    target={treeMenu.target}
    title={treeMenu.title}
    x={treeMenu.x}
    y={treeMenu.y}
    onclose={closeTreeMenu}
    ondefinition={defineFromTree}
    rel={treeMenu.rel}
    onopen={openData}
    onselect={selectInto}
  />
{/if}

<!-- 스크립트 탭의 우클릭 메뉴 — 트리 메뉴와 같은 까닭으로 `.query` 밖 -->
{#if tabMenu}
  <ScriptTabMenu
    n={tabMenu.n}
    title={tabMenu.title}
    data={tabMenu.data}
    canClose={sc.tabs.length > 1}
    x={tabMenu.x}
    y={tabMenu.y}
    onclose={closeTabMenu}
    onrename={sc.startRename}
    onsave={saveTabSql}
    onclosetab={(n) => void sc.closeTabN(n)}
  />
{/if}

<style>
  .query {
    container: qtile / inline-size;
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    /* 글래스 크롬 타일이면 판(흐림 + `--glass-mid`)은 타일 상자가 한 번 칠한다 — 여기는 `--tile-inner`(투명 · `PaneHost`) */
    background: var(--tile-inner, var(--bg-panel));
    color: var(--fg);
    font-family: var(--font-ui);
    outline: none;
    /* 놓을 곳(`.file-drop`)의 기준 — 컨테이너(`qtile`)가 이미 그 기준이라 다른 자식의 자리는 바뀌지 않는다 */
    position: relative;
  }

  /* 끌어 놓기의 놓을 곳 — 점선 테두리 + 두 줄(포인터는 아래 칸이 아니라 타일이 받는다) */
  .file-drop {
    position: absolute;
    inset: 4px;
    z-index: 30;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    border: 2px dashed var(--accent);
    border-radius: var(--radius);
    background: color-mix(in srgb, var(--bg-panel) 82%, transparent);
    pointer-events: none;
    text-align: center;
  }

  /* 글자 카드 — 면이 반투명이라 뒤의 단축키 줄과 겹쳐 읽히지 않게 불투명 바탕을 깐다 */
  .file-drop-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: 10px 18px;
    background: var(--surface-raised-solid);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    box-shadow: var(--shadow-md, 0 6px 18px rgb(0 0 0 / 0.16));
  }

  .file-drop-main {
    font-size: 13px;
    color: var(--fg);
  }

  .file-drop-sub {
    font-size: 11px;
    color: var(--fg-3);
  }

  .tree-toggle {
    align-self: center;
    margin-right: 2px;
  }

  /*
   * 머리줄 안의 트리 토글(④판) — 테두리 없이 아이콘만, 호버 · 누르는 순간 옅은 판(머리줄 `.head-btn` 과 같은 결 · 24px).
   * 머리줄 왼쪽 무리의 칸이라 포커스 밖에서 접힐 때 지울 앞 간격 = 머리줄 `gap`(`--head-act-gap` — `PaneHeader` "드러냄" 절).
   */
  .tree-toggle.inhead {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    width: 24px;
    height: 24px;
    margin: 0;
    padding: 0;
    color: var(--fg-3);
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    cursor: pointer;
    overflow: hidden;
    --head-act-gap: var(--space-2);
  }

  /* 좁은 타일의 드롭다운 단추는 그림 둘(패널 · ▾) — 24px 에 가두면 ▾ 가 잘린다. 줄지 않는 제 폭 */
  .tree-toggle.inhead.drop {
    width: auto;
    gap: 2px;
    padding: 0 5px;
  }

  .tree-toggle.inhead:hover {
    color: var(--fg-2);
    background: color-mix(in srgb, var(--fg) 7%, var(--surface-hover));
  }

  .tree-toggle.inhead:active {
    color: var(--fg-1);
    background: color-mix(in srgb, var(--fg) 11%, var(--surface-hover));
  }

  /* 좁은 타일의 드롭다운 단추(▾) — 아이콘이 넓은 토글의 아이콘과 같은 x 에 서게 왼쪽 안쪽 여백 (24 − 14) / 2 = 5px */
  .tree-toggle.inhead.drop {
    width: auto;
    gap: 2px;
    padding: 0 3px 0 5px;
  }

  .tree-toggle.inhead.drop[aria-expanded="true"] {
    color: var(--fg-1);
    background: color-mix(in srgb, var(--fg) 11%, var(--surface-hover));
  }

  .btn.icon.drop {
    display: inline-flex;
    align-items: center;
    gap: 2px;
  }

  .btn.icon.drop[aria-expanded="true"] {
    color: var(--fg);
    background: var(--bg-hover);
  }

  .tree-toggle.inhead:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: -2px;
  }

  .btn {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 3px 8px;
    font-family: var(--font-ui);
    font-size: 11px;
    line-height: 1.4;
    color: var(--fg-muted);
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--radius);
    cursor: pointer;
  }

  .btn.icon {
    padding: 3px 5px;
  }

  .btn:hover:not(:disabled) {
    color: var(--fg);
    background: var(--bg-hover);
  }

  .btn[aria-pressed="true"] {
    color: var(--fg);
  }

  .btn:disabled {
    opacity: 0.45;
    cursor: default;
  }

  .btn:focus-visible {
    outline: 1px solid var(--focus-border);
    outline-offset: -1px;
  }

  .banner {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 10px;
    font-size: var(--t-xs);
    color: var(--fg-1);
    background: var(--err-soft);
    border-bottom: 1px solid var(--line);
  }

  .banner .msg {
    flex: 1 1 auto;
    min-width: 0;
    user-select: text;
  }

  .main {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
  }

  .hsplit {
    flex: 0 0 auto;
    position: relative;
    background: var(--line);
    outline: none;
  }

  .hsplit {
    height: 1px;
    cursor: row-resize;
  }

  /* 잡기 쉽게 — 보이는 선은 1px, 잡는 자리는 넓게 */
  .hsplit::after {
    content: "";
    position: absolute;
    z-index: 3;
  }

  .hsplit::after {
    inset: -3px 0;
  }

  .hsplit:hover,
  .hsplit:focus-visible {
    background: var(--focus-border);
  }

  .work {
    flex: 1 1 auto;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  .ed {
    flex: 0 0 auto;
    min-height: 48px;
  }

  /* 데이터 탭이 보이는 동안 숨는 쿼리 탭의 칸 — 편집기는 산 채로 둔다(탭마다 되돌리기 기록) */
  .gone {
    display: none !important;
  }

  .data-tabs {
    display: none;
    flex: 1 1 auto;
    min-height: 0;
    flex-direction: column;
  }

  .data-tabs.shown {
    display: flex;
  }

  .data-tab {
    display: none;
    flex: 1 1 auto;
    min-height: 0;
    flex-direction: column;
  }

  .data-tab.on {
    display: flex;
  }

  /* 아래 칸의 [결과 | DDL] — 정의를 연 뒤에만 선다 */
  .out-tabs {
    flex: 0 0 auto;
    display: flex;
    align-items: stretch;
    gap: 2px;
    padding: 3px 6px 0;
    border-bottom: 1px solid var(--line);
    font-size: 11px;
  }

  .otab,
  .otab-x {
    font-family: var(--font-ui);
    font-size: 11px;
    color: var(--fg-2);
    background: transparent;
    border: none;
    cursor: pointer;
  }

  .otab {
    padding: 3px 10px 4px;
    border-bottom: 2px solid transparent;
  }

  .otab[aria-selected="true"] {
    color: var(--fg);
    border-bottom-color: var(--accent);
  }

  .otab-pair {
    display: inline-flex;
    align-items: stretch;
  }

  .otab-pair .otab {
    padding-right: 4px;
  }

  .otab-x {
    display: inline-flex;
    align-items: center;
    padding: 0 6px 0 2px;
    color: var(--fg-3);
    border-bottom: 2px solid transparent;
  }

  .otab-pair.on .otab-x {
    border-bottom-color: var(--accent);
  }

  .otab:hover,
  .otab-x:hover {
    color: var(--fg);
  }

  .otab:focus-visible,
  .otab-x:focus-visible {
    outline: 1px solid var(--focus-border);
    outline-offset: -1px;
  }

  .out {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  .out > :global(*) {
    flex: 1 1 auto;
    min-height: 0;
  }

  /* 결과가 없는 연결 사건의 머리 줄(결과 패널 요약 줄과 같은 결 — 갈래마다 의미색) */
  .out > .note-line {
    flex: 0 0 auto;
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 6px 10px;
    font-size: var(--t-xs);
    color: var(--fg-1);
    border-bottom: 1px solid var(--line);
  }

  .note-line .note-icon {
    flex: 0 0 auto;
    display: inline-flex;
    margin-top: 1px;
  }

  .note-line.tone-ok {
    background: color-mix(in srgb, var(--ok) 8%, transparent);
  }

  .note-line.tone-ok .note-icon {
    color: var(--ok);
  }

  .note-line.tone-info .note-icon {
    color: var(--accent);
  }

  .note-line.tone-err {
    background: var(--err-soft);
    font-weight: var(--fw-semibold);
  }

  .note-line.tone-err .note-icon {
    color: var(--err);
  }

  .note-line .msg {
    flex: 1 1 auto;
    min-width: 0;
    user-select: text;
  }

  .tx-why {
    display: block;
    font-weight: normal;
    white-space: pre-wrap;
    color: var(--fg-2);
  }

  .out-note {
    margin: 0;
    padding: var(--space-3);
    font-size: var(--t-sm);
    color: var(--fg-2);
    overflow: auto;
  }

  .out-note p {
    margin: 0 0 var(--space-2);
  }

  .out-note .safety {
    font-size: var(--t-xs);
    color: var(--fg-3);
    line-height: 1.5;
  }

  .out-note .keys {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1) var(--space-3);
    font-size: var(--t-xs);
    color: var(--fg-3);
  }

  .out-note .keys > span {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
  }

  .out-note .safety.on {
    color: var(--err);
  }
</style>
