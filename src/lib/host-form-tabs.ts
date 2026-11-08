import { MAX_SCROLLBACK, MIN_SCROLLBACK } from "$lib/session";

/**
 * 호스트 폼의 **순수한 속** — 칸 → 탭 표와, 저장 전에 보는 규칙
 * (docs/log/2026-09-20-host-form-tabs.md).
 *
 * 폼이 세 탭으로 갈리면서 생긴 문제 하나를 이 파일이 맡는다: **저장이 걸린 칸이 지금 안
 * 보이는 탭에 있을 수 있다.** 오류 한 줄은 패널 바깥이라 늘 보이는데, 그 줄이 가리키는
 * 칸(포트·스크롤백·포워딩 줄)은 다른 탭에 숨어 있을 수 있어 "고치라는데 고칠 칸이 없는"
 * 화면이 된다. `hosts.svelte.ts` 가 문구와 **함께** 칸 id 를 내고(`hostFormErrorField`),
 * `HostForm.svelte` 가 이 표로 그 칸의 탭을 찾아 옮겨 간다.
 *
 * 표가 컴포넌트 밖에 있는 이유는 하나다 — **순수 함수라 테스트가 붙는다**. 탭이 늘거나
 * 칸이 옮겨 가면 그 자리에서 깨진다 (`host-form-tabs.test.ts`).
 *
 * 저장 전 검증(`validateHostForm`)이 **같은 파일에 있는 것도 그래서다**: 그 함수가 내는 것은
 * 곧 위 표의 열쇠(`f-…`)라, 둘이 쓰는 낱말이 한 파일 안에서만 맞으면 된다.
 */

/**
 * 폼의 다섯 탭. id 는 화면에 보이지 않는 코드 식별자라 영어 그대로다.
 *
 * `ai` 는 2026-10-07 에 더해졌다 — 세션 탭 맨 아래에 있던 "AI 위임 (헤드리스)" 묶음이 **AI 권한**
 * (원격 세션의 권한 = 호스트 하나의 단계)으로 넓어지며 제 칸을 얻었다. 파일은 `delegation.toml` 이다.
 *
 * `agent` 는 2026-10-26 — **에이전트 활성화**(옛 AI 칸의 "원격 AI 훅 자동 설치")와 원격 추가 인자가 AI 권한 앞에 제 칸을
 * 얻었다. 파일은 `sessions.toml` 이다.
 */
export type HostFormTab = "connect" | "display" | "session" | "agent" | "ai";

/** `{#each}` 로 도는 목록의 순서와 같은 순서 — 왼쪽 내비의 위에서 아래다 */
export const HOST_FORM_TABS = ["connect", "display", "session", "agent", "ai"] as const satisfies readonly HostFormTab[];

/**
 * 칸 id → 탭.
 *
 * 열쇠는 **마크업의 요소 id 그대로**다(`f-…`). 헤드리스 검증 스크립트도 같은 글자를 집으므로
 * 이 표의 키를 바꾸는 것은 곧 그 스크립트를 깨는 일이다 (docs/conventions.md 의 "id 는 안 바뀐다").
 *
 * 칸이 아니라 **줄의 이름**인 둘(`f-forwards-label`·`f-vault-label`)도 들어 있다 — 포워딩
 * 프리셋과 저장된 자격증명은 `<label for>` 로 잡을 칸이 하나가 아니라, 가리킬 수 있는 것이
 * 그 이름표뿐이다.
 */
const FIELD_TAB: Readonly<Record<string, HostFormTab>> = {
  // 접속 — `~/.ssh/config` 에 적히는 것들 + 볼트 줄
  "f-name": "connect",
  "f-hostname": "connect",
  "f-user": "connect",
  "f-port": "connect",
  "f-identity": "connect",
  "f-identities-only": "connect",
  // 에이전트 포워딩 — 파일은 `sessions.toml` 이지만 **접속의 성질**이라 여기 둔다.
  "f-forward-agent": "connect",
  "f-proxy-jump": "connect",
  "f-vault-label": "connect",
  // 표시 — `sessions.toml` 의 겉모양
  "f-color": "display",
  "f-icon": "display",
  "f-group": "display",
  "f-tags": "display",
  // 세션 — `sessions.toml` 의 동작
  "f-scrollback": "session",
  "f-onconnect": "session",
  "f-tmux": "session",
  "f-shellint": "session",
  "f-log": "session",
  "f-forwards-label": "session",
  // 에이전트 — `sessions.toml` 의 `agent` · `agent_args` (추가 인자 칸 id 는 `f-agent-args-<에이전트 id>`)
  "f-agent": "agent",
  "f-agent-args-claude": "agent",
  "f-agent-args-codex": "agent",
  // AI 권한 — `~/.aynx/delegation.toml` (단계 버튼 묶음의 이름표 · 헤드리스 둘)
  "f-ai-stage-label": "ai",
  "f-delegation-connect": "ai",
  "f-delegation-vault": "ai",
};

/**
 * 그 칸이 있는 탭 (모르는 id·`null` 이면 `null` — **아무 데도 데려가지 않는다**).
 *
 * 모르는 값을 조용히 첫 탭으로 접지 않는 것이 요점이다: 백엔드 오류처럼 칸을 특정할 수 없는
 * 실패는 `null` 로 오고, 그때 사용자가 보던 탭을 빼앗으면 방금 고치던 칸이 화면에서 사라진다.
 */
export function tabOfField(id: string | null | undefined): HostFormTab | null {
  if (id === null || id === undefined) return null;
  return FIELD_TAB[id] ?? null;
}

/**
 * 저장을 막는 칸 하나 — **처음 걸린 것**만 낸다 (칸 순서대로 본다).
 *
 * `kind` 는 문구가 아니라 **갈래**다: 문구는 `t()` 를 지나야 하고 스크롤백 것은 자리표시자
 * 둘을 받는데, 그 둘을 이 파일로 끌고 오면 순수 모듈이 i18n 상태에 묶인다. 부르는 쪽
 * (`hosts.svelte.ts`)이 갈래를 문구로 바꾼다.
 */
export type HostFormProblem =
  | { field: "f-name"; kind: "name" }
  | { field: "f-hostname"; kind: "hostname" }
  | { field: "f-port"; kind: "port" }
  | { field: "f-scrollback"; kind: "scrollback" };

/** `validateHostForm` 이 보는 것 — 폼 전체가 아니라 이 넷이다 */
export interface HostFormValues {
  name: string;
  hostName: string;
  port: number | null;
  scrollback: number | null;
}

/**
 * 저장 전 프런트 검증 (틀린 데가 없으면 `null`).
 *
 * **왜 별칭·호스트 주소까지 여기서 보는가**: 예전에는 그 둘을 마크업의 `required` 가 막았다.
 * 폼이 탭으로 갈리면서 그 길이 막다른 길이 됐다 — 빈 칸이 지금 `hidden` 인 탭에 있으면
 * 브라우저가 말풍선을 띄울 곳을 못 찾고 **제출 자체를 취소한다**(`An invalid form control …
 * is not focusable`). 눌러도 아무 일이 없고 저장 함수는 시작조차 하지 않는다. 그래서
 * `<form novalidate>` 로 그 길을 닫고, 그것이 보던 규칙을 앱이 직접 본다.
 *
 * 포트·스크롤백은 앞서부터 앱이 보던 것이다 — 범위를 벗어난 포트는 invoke 직렬화 단계에서
 * 알아보기 어려운 오류가 되고(u16), 범위를 벗어난 스크롤백은 탭이 조용히 무시해 "적었는데
 * 안 먹는" 값으로 파일에 남는다. 나머지 규칙은 백엔드가 단일 진실이다.
 *
 * 포워딩 줄은 여기 없다 — 그쪽 규칙은 `forward.ts` 의 `parseForwardRows` 가 이미 쥐고 있고,
 * 틀린 **줄 번호**까지 돌려준다.
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
