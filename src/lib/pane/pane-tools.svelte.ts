// **타일 머리줄에 얹는 도구줄** (2026-10-20 — 타일 제목줄 개편, 목업 SJgp6bQEPiRYkBCvjy3NuL).
//
// 문서 · 쿼리 · 브랜치 · diff · 파일 타일은 예전에 머리줄(이름 · ⋯ ⤢ ✕) 아래 제 도구줄이 한 줄 더 서서 위가 두 줄 · 선 둘이었다.
// 이제 **머리줄이 서 있으면** 도구줄이 머리줄 가운데로 올라가 한 줄이 된다(왼쪽 아이콘 · 이름 → 가운데 도구 → 오른쪽 ⋯ ⤢ ✕).
//
// ## 모양 — 표 둘
//
// - **도구 표**(`setPaneTools`) — 타일 컴포넌트가 제 도구줄을 **스니펫**으로 맡긴다. 스니펫은 정의한 컴포넌트의 상태 · 스코프 CSS 를
//   그대로 들고 다니므로 머리줄(`PaneHeader`)이 그리기만 하면 단추 · 단축키 · 접기 규칙이 예전 그대로다. 인자 하나(`inHead` — 머리줄 안인가)로
//   테두리 · 여백만 갈린다.
// - **머리줄 표**(`markPaneHead`) — 머리줄이 지금 서 있는 타일. 머리줄을 끈 설정(`[app] tile_header`)이나 폰 배치(머리줄 없음)에서는
//   타일이 제 도구줄을 예전 자리(몸 맨 위)에 그린다 — 도구줄이 갈 곳을 잃지 않는다.
//
// ## 늘 보임 / 드러날 때만 — `data-head-act` (2026-10-20 사용자 실기)
//
// 포커스 밖 타일의 머리줄에서는 `⋯ ⤢ ×` 가 숨는다(`PaneHeader` 스타일의 "드러냄" 절 — 포커스 · 호버 · 키보드 포커스 · 터치일 때만 보인다).
// 도구줄도 같은 규칙 하나를 따른다. 타일은 스니펫 안의 **조작 요소**(새로고침 · 새 폴더 · 업로드 · 보기 · 찾기 · 편집 · 외부 열기 · 트리 토글 …)에
// `data-head-act` 를 단다 — 그 요소는 숨을 때 **자리도 접고**(폭 0 · 여백 0 · 앞 간격 지움), 표시가 없는 요소는 **상태 · 정체**로 늘 보인다
// (스크립트 탭 · 경로 · 기준 브랜치 · 읽기 전용 표지 …). 그래서 포커스 밖 타일은 상태 칸이 오른쪽 끝까지 붙어 선다.
//
// - 표시는 **안쪽 여백이 있는 단추에 바로** 달아도 된다(접을 때 여백 · 테두리 폭도 0 이 된다). 여러 단추를 한 덩어리로 접으려면 그 무리 상자에 단다.
// - 그 요소를 담은 줄(flex 상자)의 `gap` 을 **`--head-act-gap`** 으로 같은 줄에 적는다(접힌 요소의 앞 간격을 음수 여백으로 지운다 — 없으면 0).
//   상속되는 값이라, 간격이 다른 안쪽 줄이 조작 요소를 담으면 그 줄에서 다시 적는다(`LocationBar` 의 `.loc` = 0).
// - `lead` 는 통째로 조작 칸이다 — 다만 아이콘 · 이름 **앞**이라 접지 않고 자리를 쥔 채 흐려진다(접으면 정체가 옆으로 미끄러진다).
// - `tail`(이름 뒤 조각) 안의 표시도 같은 규칙이다 — 다만 `span`(왼쪽 무리 폭 고정) 중에는 접혀도 무리 폭이 그대로라 뒤 칸이 밀리지 않는다.
// - 표시는 머리줄 안에서만 뜻이 있다 — 머리줄이 없어 몸 위에 그릴 때(`inHead` 거짓)는 아무 일도 하지 않는다.
//
// **쓰기는 반응형 값을 구독하지 않는다**(`untrack`) — 두 표 모두 `$effect` 안에서 등록하므로, 등록이 제가 쓴 표를 읽어 스스로를
// 다시 돌리지 않게(`app/doc-dirty.svelte.ts` 머리말과 같은 함정).

import { untrack, type Snippet } from "svelte";
import type { PaneMenuItem } from "$lib/pane/pane-menu";

/** 한 타일이 머리줄에 맡기는 것 */
export interface PaneTools {
  /** 머리줄 가운데(이름 뒤 · ⋯ 앞)에 그릴 도구줄 — 인자 = 머리줄 안에서 그리는가 */
  bar: Snippet<[boolean]>;
  /**
   * 머리줄 맨 앞(타일 아이콘 앞)에 그릴 것 — 파일 타일의 뒤로/앞으로 · 보기 고르개(쿼리 타일의 트리 토글은 `tail` — 로고 · 이름이 먼저, 10-20 실기).
   * **통째로 조작 칸**이다 — 포커스 밖에서는 자리를 쥔 채 흐려진다(머리말 "늘 보임 / 드러날 때만")
   */
  lead?: Snippet;
  /**
   * 이름 묶음 **바로 뒤**(가운데 도구줄 앞)에 그릴 것 — 쿼리 타일의 사이드바 토글 · 문서 타일의 목차 토글(10-20 ④판). 안의 조작 요소는 `bar` 처럼 `data-head-act` 를
   * 달면 포커스 밖에서 숨고 자리도 접는다(머리줄의 `gap` 을 앞 간격으로 — 단 사이드바 폭 고정(`span`) 중에는 무리 폭이 그대로라 탭이 밀리지 않는다).
   */
  tail?: Snippet;
  /**
   * **왼쪽 무리 폭 고정**(④판 — 본문 왼쪽 곁 패널 경계: 쿼리 타일 사이드바 · 문서 타일 목차 패널, 계산은 `pane/head-span.ts`) — 값이 수이면 머리줄의 왼쪽 무리(맨 앞 조각 · 아이콘 · 이름 · `tail`)가 머리줄 왼쪽 끝부터 정확히
   * 그 px 까지를 차지하고(무리 뒤 `gap` 포함 — 가운데 도구줄이 **그 x 에서** 시작한다), 이름은 남는 폭 안에서 말줄임 · `tail` 은 무리 오른쪽 끝이다.
   * 머리줄과 몸은 같은 타일 상자 안에 `left: 0` 으로 서므로(`PaneHost` 의 `.pane-body` · `.pane-head`) 몸 안 x 를 그대로 주면 된다.
   * 파일 타일은 장소 패널이 펼쳐져 있을 때 맨 앞 조각(뒤로/앞으로 · 보기)이 그 폭을 쥐고 경로 칸이 목록 열 위에서 시작한다(`filePlacesLayout`).
   * `null` 이면 지금처럼(이름 묶음은 제 폭까지). 반응형으로 읽힌다(사이드바를 끄는 동안 함께 움직인다 — 등록을 다시 하지 않게 함수로 준다)
   */
  span?: () => number | null;
  /**
   * **아이콘 자리의 도는 고리** — 글자(말풍선 · 읽기 도구의 `role="status"`)를 주면 그동안 타일 아이콘 대신 같은 크기의 회전 고리가 선다
   * (쿼리 타일이 연결 중일 때 — 10-20 사용자 결정, `null` 이면 아이콘). 반응형으로 읽힌다
   */
  iconBusy?: () => string | null;
  /** **이름 자리를 대신하는가** — 파일 타일(B안): 빵부스러기 경로가 곧 그 타일의 이름이다(이름 = 위치 — 용어표) */
  replaceName?: boolean;
  /**
   * **타일 아이콘을 그리지 않는가** — 파일 타일(10-20 사용자): 맨 앞 조각(뒤로/앞으로 · 보기) 뒤 곧바로 경로 칸이다. 로컬 · 원격은 경로 칸의
   * 첫 조각이 말한다(로컬 `내 PC` · 원격 `<별칭>:/`). `iconBusy` 가 글자를 주면 고리는 선다
   */
  hideIcon?: boolean;
  /**
   * **이름 말풍선에 덧붙일 줄** — 늘 같은 성질이라 줄에 세울 만큼은 아닌 것(브랜치 타일의 "읽기 전용 · main 기준" — 10-20 사용자).
   * 이름 말풍선의 둘째 줄부터 선다. 반응형으로 읽힌다(`null` 이면 덧붙이지 않는다)
   */
  nameTip?: () => string | null;
  /**
   * 머리줄 ⋯ 메뉴 **맨 위**에 얹을 줄 — 파일 타일의 도구 ⋯ 를 타일 ⋯ 와 합친 것(B안). 줄의 액션은 `tool:<열쇠>` 이고 누르면 [`run`] 이
   * 그 열쇠로 불린다(통로는 `PaneHost` 의 `runTileMenu` → `runOnMenu`). 메뉴가 열릴 때마다 부른다(반응형으로 읽어도 된다).
   */
  menu?: () => PaneMenuItem[];
  run?: (key: string) => void;
}

/** 머리줄 메뉴의 도구 줄 액션 접두사 — `tool:<열쇠>` */
export const TOOL_ACTION_PREFIX = "tool:";

let tools = $state.raw<ReadonlyMap<string, PaneTools>>(new Map());
let heads = $state.raw<ReadonlySet<string>>(new Set());

/** 그 타일이 맡긴 도구줄 — 없으면 `null`. 반응형으로 읽힌다 */
export function paneToolsOf(paneId: string): PaneTools | null {
  return tools.get(paneId) ?? null;
}

/** 도구줄을 맡긴다. 돌려준 함수로 푼다(같은 것이 아직 맡겨져 있을 때만 지운다 — 재마운트 순서가 뒤집혀도 새 것을 지우지 않게) */
export function setPaneTools(paneId: string, value: PaneTools): () => void {
  untrack(() => {
    const next = new Map(tools);
    next.set(paneId, value);
    tools = next;
  });
  return () =>
    untrack(() => {
      if (tools.get(paneId) !== value) return;
      const next = new Map(tools);
      next.delete(paneId);
      tools = next;
    });
}

/** 그 타일의 머리줄이 지금 서 있는가 — 반응형으로 읽힌다(타일이 제 도구줄을 그릴지 정한다) */
export function paneHeadShown(paneId: string): boolean {
  return heads.has(paneId);
}

/** 머리줄이 섰다(`PaneHeader` 의 `$effect`) — 돌려준 함수로 걷는다 */
export function markPaneHead(paneId: string): () => void {
  untrack(() => {
    if (heads.has(paneId)) return;
    const next = new Set(heads);
    next.add(paneId);
    heads = next;
  });
  return () =>
    untrack(() => {
      if (!heads.has(paneId)) return;
      const next = new Set(heads);
      next.delete(paneId);
      heads = next;
    });
}
