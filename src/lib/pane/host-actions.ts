import { getContext, setContext } from "svelte";
import type { HostEntry, HostsDrag } from "$lib/hosts";
import type { QuickConnectTarget } from "$lib/quick-connect";

/** 호스트 트리가 위로 올리는 뜻들 — 주인은 창마다 `+page` 하나라 컨텍스트로 내려간다 */
export interface HostActions {
  onconnect: (host: HostEntry) => void;
  /** `group` = 트리가 지금 보고 있는 폴더(추가 모달의 그룹 칸을 미리 채운다) */
  onaddhost: (group?: string) => void;
  onedithost: (host: HostEntry) => void;
  onnewsession: (host: HostEntry) => void;
  onconnectnew: (host: HostEntry) => void;
  oninstallkey: (host: HostEntry) => void;
  onrenamehost: (host: HostEntry) => void;
  onduplicatehost: (host: HostEntry) => void;
  /** 확인은 상위가 받는다 */
  onforgethostkey: (host: HostEntry) => void;
  /** 확인은 트리가 이미 받았다 */
  onremovehosts: (hostNames: string[]) => void;
  /** 제거 확인 문구에 붙일 "함께 정리되는 것" 한 줄 — 세는 목록은 상위가 주인이라 트리가 들여오지 않는다 */
  onhostrefs?: (hostNames: string[]) => string | null;
  onopenconfig: () => void;
  onassigngroups: (hostNames: string[], group: string | null) => void;
  onduplicatehosts: (items: { name: string; group: string | null }[]) => void;
  onhosts?: (hosts: HostEntry[]) => void;
  onnotice?: (message: string) => void;
  /** 어디에 여느냐가 뜻의 일부라 `tabId` · `paneId` 를 받는다 — `Sidebar` 가 프롭으로 받아 채운다 */
  onopenhosts?: (tabId: string, paneId: string, payload: HostsDrag) => void;
  onquickconnect: (target: QuickConnectTarget) => void;
  /** 없으면 그 항목을 그리지 않는다 */
  onopendb?: (host: HostEntry, dbId: string) => void;
  onadddb?: (host: HostEntry) => void;
  refreshKey?: number;
}

const HOST_ACTIONS = Symbol("host-actions");

/** 값이 변하는 항목(`refreshKey`)은 게터로 담아야 꺼내 쓰는 쪽의 `$effect` 가 다시 돈다 */
export function setHostActions(actions: HostActions): void {
  setContext(HOST_ACTIONS, actions);
}

/** 없으면 던진다 — 조용히 `undefined` 를 흘리면 나중에 클릭 무반응으로만 드러난다 */
export function hostActions(): HostActions {
  const found = getContext<HostActions | undefined>(HOST_ACTIONS);
  if (!found) {
    throw new Error("호스트 조작 컨텍스트가 없다 — 최상위에서 setHostActions() 를 부르지 않았다");
  }
  return found;
}
