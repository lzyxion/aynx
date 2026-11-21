import { MAX_SCROLLBACK, MIN_SCROLLBACK } from "$lib/session";

/** 호스트 폼의 칸 → 탭 표와 저장 전 검증 — 저장을 막은 칸이 안 보이는 탭에 있으면 폼이 이 표로 그 탭을 연다 */

export type HostFormTab = "connect" | "display" | "session" | "agent" | "ai";

export const HOST_FORM_TABS = ["connect", "display", "session", "agent", "ai"] as const satisfies readonly HostFormTab[];

/**
 * 열쇠는 마크업의 요소 id 그대로다 — 헤드리스 검증 스크립트도 같은 글자를 집는다(docs/conventions.md 의 "id 는 안 바뀐다").
 * `f-forwards-label` · `f-vault-label` 은 칸이 아니라 줄의 이름표다 — 가리킬 칸이 하나가 아니다.
 */
const FIELD_TAB: Readonly<Record<string, HostFormTab>> = {
  "f-name": "connect",
  "f-hostname": "connect",
  "f-user": "connect",
  "f-port": "connect",
  "f-identity": "connect",
  "f-identities-only": "connect",
  "f-forward-agent": "connect",
  "f-proxy-jump": "connect",
  "f-vault-label": "connect",
  "f-color": "display",
  "f-icon": "display",
  "f-group": "display",
  "f-tags": "display",
  "f-scrollback": "session",
  "f-onconnect": "session",
  "f-tmux": "session",
  "f-shellint": "session",
  "f-log": "session",
  "f-forwards-label": "session",
  // 추가 인자 칸 id 는 `f-agent-args-<에이전트 id>`
  "f-agent": "agent",
  "f-agent-args-claude": "agent",
  "f-agent-args-codex": "agent",
  "f-ai-stage-label": "ai",
  "f-delegation-connect": "ai",
  "f-delegation-vault": "ai",
};

/** 모르는 id 는 첫 탭으로 접지 않고 `null` — 칸을 특정 못 하는 실패에 탭을 빼앗으면 고치던 칸이 사라진다 */
export function tabOfField(id: string | null | undefined): HostFormTab | null {
  if (id === null || id === undefined) return null;
  return FIELD_TAB[id] ?? null;
}

/** 처음 걸린 칸 하나만 낸다. `kind` 는 문구가 아니라 갈래다 — 순수 모듈을 i18n 상태에 묶지 않는다 */
export type HostFormProblem =
  | { field: "f-name"; kind: "name" }
  | { field: "f-hostname"; kind: "hostname" }
  | { field: "f-port"; kind: "port" }
  | { field: "f-scrollback"; kind: "scrollback" };

export interface HostFormValues {
  name: string;
  hostName: string;
  port: number | null;
  scrollback: number | null;
}

/**
 * 폼은 `novalidate` 다 — 빈 `required` 칸이 `hidden` 탭에 있으면 브라우저가 제출 자체를 조용히 취소하므로 그 규칙을 여기서 본다.
 * 포워딩 줄은 `forward.ts` 의 `parseForwardRows` 가, 나머지 규칙은 백엔드가 본다.
 */
export function validateHostForm(v: HostFormValues): HostFormProblem | null {
  if (v.name.trim() === "") return { field: "f-name", kind: "name" };
  if (v.hostName.trim() === "") return { field: "f-hostname", kind: "hostname" };
  if (v.port !== null && (!Number.isInteger(v.port) || v.port < 1 || v.port > 65535)) {
    return { field: "f-port", kind: "port" };
  }
  if (
    v.scrollback !== null &&
    (!Number.isInteger(v.scrollback) ||
      v.scrollback < MIN_SCROLLBACK ||
      v.scrollback > MAX_SCROLLBACK)
  ) {
    return { field: "f-scrollback", kind: "scrollback" };
  }
  return null;
}
