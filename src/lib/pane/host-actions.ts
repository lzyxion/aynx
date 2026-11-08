import { getContext, setContext } from "svelte";
import type { HostEntry, HostsDrag } from "$lib/hosts";
import type { QuickConnectTarget } from "$lib/quick-connect";

/**
 * 호스트 트리(`Sidebar` — 지금은 독 안에서만 산다)가 위로 올리는 **뜻들** — 호스트
 * 조작(추가·수정·제거·그룹 지정)의 주인은 `+page` 한 곳이다
 * (docs/log/2026-09-03-hosts-tile.md · docs/log/2026-09-08-remove-hosts-tile.md).
 *
 * ## 프롭이 아니라 **컨텍스트**로 내려간다 (docs/log/2026-09-05-refactor-structure.md)
 *
 * 예전에는 `+page` → `PaneHost` → `Sidebar` → `HostMenu` 로 콜백 열다섯 개가
 * `{...hostActions}` 로 흘러갔다. 중간의 둘은 그 값을 **읽지 않는다** — 그런데도 프롭 표면에
 * 이름 열다섯 개를 늘어놓아야 했고, 하나를 더하거나 이름을 바꾸면 네 파일이 함께 움직였다.
 * (그 통로가 실제로 새는 자리이기도 했다 — `df50f27` 는 통로가 대상을 잃어 메뉴가 통째로
 * 무반응이 된 버그다.)
 *
 * 이제 `+page` 가 최상위에서 [`setHostActions`] 를 한 번 부르고, **실제로 쓰는 컴포넌트만**
 * [`hostActions`] 로 꺼낸다. 중간 컴포넌트의 프롭에서는 이름이 사라진다.
 *
 * 컨텍스트가 맞는 이유는 이 묶음이 **창 하나에 하나뿐인 값**이기 때문이다: 그 조작의
 * 주인은 언제나 그 창의 `+page` 하나다 (티어아웃으로 뜬 창도 같은 `+page` 라 자기 것을
 * 자기가 심는다). 자리마다 달라지는 값은 여기 없다 — 유일하게 "어디에 여느냐" 가 필요한
 * [`HostActions.onopenhosts`] 만 `tabId`·`paneId` 를 인자로 받고, 그 둘은 `Sidebar` 가
 * 프롭으로 받는다 (독이 활성 탭·포커스된 타일을 채워 넣는다).
 */
export interface HostActions {
  onconnect: (host: HostEntry) => void;
  /**
   * "＋ 호스트 추가". `group` 은 트리가 **지금 보고 있는 폴더**를 실어 보내는 것으로,
   * 상위가 추가 모달의 그룹 칸을 미리 채우라는 뜻이다 (생략/`""` 이면 그룹 없음).
   */
  onaddhost: (group?: string) => void;
  onedithost: (host: HostEntry) => void;
  onnewsession: (host: HostEntry) => void;
  /** 우클릭 "새 탭에서 열기" */
  onconnectnew: (host: HostEntry) => void;
  /** 우클릭 "공개키 설치…" (ssh-copy-id 상당 — docs/log/2026-09-03-copy-id-ui.md) */
  oninstallkey: (host: HostEntry) => void;
  onrenamehost: (host: HostEntry) => void;
  onduplicatehost: (host: HostEntry) => void;
  /**
   * 우클릭 "호스트 키 잊기" — 이 호스트의 `known_hosts` 기록을 지운다
   * (docs/log/2026-09-16-quick-connect-and-host-keys.md). 확인은 **상위가** 받는다
   * (`ask()`), 트리는 뜻만 올린다.
   */
  onforgethostkey: (host: HostEntry) => void;
  /** 우클릭 "제거" · `Delete` — 여럿을 한 번에 (확인은 트리가 이미 받았다) */
  onremovehosts: (hostNames: string[]) => void;
  /**
   * 제거 확인 문구에 붙일 **"함께 정리되는 것" 한 줄** (걸리는 자리가 없으면 `null`) —
   * docs/log/2026-09-17-host-remove-fanout.md.
   *
   * 트리가 직접 세지 않고 물어보는 이유는 세는 자리가 넷(즐겨찾기·스니펫·레이아웃·열린 탭)
   * 이고 전부 **상위가 주인인 목록**이기 때문이다. 트리가 그 넷을 직접 들여오면 독 안의
   * 파일 탐색기가 앱의 절반에 얽힌다 — 이 묶음이 애초에 그것을 막으려고 있다.
   */
  onhostrefs?: (hostNames: string[]) => string | null;
  onopenconfig: () => void;
  /** 폴더로 끌어다 놓기 · 잘라내기 붙여넣기 — 여럿의 그룹을 한 번에 (재)지정한다 */
  onassigngroups: (hostNames: string[], group: string | null) => void;
  /** 복사 붙여넣기 — 이 호스트들을 복제하고 새 별칭의 그룹을 각각 지정한다 */
  onduplicatehosts: (items: { name: string; group: string | null }[]) => void;
  onhosts?: (hosts: HostEntry[]) => void;
  onnotice?: (message: string) => void;
  /**
   * 우클릭 "전체 열기 (타일)" — 고른 호스트·폴더를 전부 격자로 연다
   * (docs/log/2026-09-03-group-open-tiled.md · docs/log/2026-09-04-hosts-multiselect.md).
   *
   * **이 묶음에서 유일하게 `tabId`·`paneId` 를 받는 콜백**이다. 나머지는 "어느 호스트를
   * 어떻게" 라는 뜻만 올리면 되지만 이것은 **어디에** 여느냐가 뜻의 일부다. 그 신원은
   * `Sidebar` 가 프롭(`tabId`·`paneId`)으로 받아 여기에 채워 넣는다 — 컨텍스트에 담기에는
   * 그때그때 다른 값이고, 그 둘이 `Sidebar` 에 남은 **유일한 호스트 관련 프롭**이다.
   */
  onopenhosts?: (tabId: string, paneId: string, payload: HostsDrag) => void;
  /**
   * **빠른 접속** — 설정에 없는 대상에 그 자리에서 붙는다
   * (docs/log/2026-09-16-quick-connect-and-host-keys.md).
   *
   * 검색 칸이 아무것도 못 찾았는데 그 글자가 접속 대상으로 읽히면 트리가 줄 하나를 띄우고,
   * 누르면 이것을 부른다. 자리 잡기는 [`onconnect`] 와 **같은 길**이라 `tabId`·`paneId` 가
   * 필요 없다 (활성 타일 옆이 곧 답이다).
   */
  onquickconnect: (target: QuickConnectTarget) => void;
  /**
   * 우클릭 "DB 열기 ›" 의 한 줄 — 그 호스트를 경유하는 DB 연결 하나를 지금 탭에 쿼리 타일로 연다(쿼리 타일 6단계 ·
   * `app/query.svelte.ts` 의 `openHostDb`). 없으면 그 항목을 그리지 않는다.
   */
  onopendb?: (host: HostEntry, dbId: string) => void;
  /** "DB 열기 ›" 하위 목록 끝의 "DB 연결 추가…" — 경유를 그 호스트로 미리 고른 DB 연결 폼(`app/query.svelte.ts` 의 `addHostDb`) */
  onadddb?: (host: HostEntry) => void;
  /** 값이 바뀌면 트리가 목록을 다시 읽는다 */
  refreshKey?: number;
}

/**
 * 컨텍스트 열쇠 — **상수 하나**다. 문자열 대신 심벌인 이유는 이 값이 앱 안에서만 오가고,
 * 심벌이면 다른 라이브러리의 같은 이름과 부딪힐 길이 아예 없기 때문이다.
 */
const HOST_ACTIONS = Symbol("host-actions");

/**
 * 호스트 조작 묶음을 이 컴포넌트 아래 전부에 심는다 — **`+page` 가 초기화에서 한 번**.
 *
 * `refreshKey` 처럼 값이 변하는 항목은 **게터로** 담아야 한다
 * (`get refreshKey() { return hostsRefreshKey(); }`). 그래야 꺼내 쓰는 쪽의 `$effect` 가
 * 그 읽기를 의존성으로 등록해, 예전에 프롭이 갈아 끼워지던 것과 같은 시점에 다시 돈다.
 */
export function setHostActions(actions: HostActions): void {
  setContext(HOST_ACTIONS, actions);
}

/**
 * 심어 둔 묶음을 꺼낸다 — **컴포넌트 초기화에서** (svelte 의 `getContext` 규칙).
 *
 * 없으면 그 자리에서 던진다. 트리는 `Ctrl+Shift+H` 로 언제든 뜰 수 있어 통로가 비어 있으면
 * 안 되는데, `undefined` 를 조용히 흘리면 그 사실이 **나중에 클릭이 무반응인 것**으로만
 * 드러난다 (프롭 시절 `hostActions` 를 필수로 둔 것과 같은 이유).
 */
export function hostActions(): HostActions {
  const found = getContext<HostActions | undefined>(HOST_ACTIONS);
  if (!found) {
    throw new Error("호스트 조작 컨텍스트가 없다 — 최상위에서 setHostActions() 를 부르지 않았다");
  }
  return found;
}
