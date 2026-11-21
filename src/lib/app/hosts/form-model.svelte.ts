import { noGrants, type DelegationGrants } from "$lib/delegation";
import { t } from "$lib/i18n/i18n.svelte.js";
import type { HostFormProblem } from "$lib/host-form-tabs";
import type { ForwardRow } from "$lib/forward";
import { MAX_SCROLLBACK, MIN_SCROLLBACK } from "$lib/session";

// `~/.ssh/config` 는 ssh · scp · VS Code 와 공유하는 원본이라 파일 전체를 재작성하지 않는다 —
// 추가는 끝에 append, 수정은 그 Host 블록만 국소 패치, 삭제는 에디터에 넘긴다.

/** 위쪽 칸은 `~/.ssh/config`, 아래는 `~/.ssh/sessions.toml`, `delegation` 은 `~/.aynx/delegation.toml` */
export interface HostForm {
  name: string;
  hostName: string;
  user: string;
  port: number | null;
  identityFile: string;
  /** 끄면 줄을 지운다(`false` 를 적지 않는다). `IdentityFile` 이 비면 켤 수 없다 — OpenSSH 가 기본 키를 그대로 쓴다 */
  identitiesOnly: boolean;
  /** config 와 같은 값이면 덮어쓰기를 지운다 — "접속" 탭에 있어도 `sessions.toml` 에 적힌다 (docs/log/2026-09-23-agent-forwarding.md) */
  forwardAgent: boolean;
  /** `""` = 직접 접속(줄을 지운다). 별칭이 아닌 글자도 올 수 있다 — [`jumpOptions`] */
  proxyJump: string;
  color: string;
  /** 빈 문자열 = 키 삭제(상속/없음) */
  icon: string;
  group: string;
  /** 칩을 만드는 자리(`tag-input.ts`)가 다듬기 · 중복을 지키므로 [저장]은 그대로 보낸다 */
  tags: string[];
  scrollback: number | null;
  onConnect: string;
  /** 체크 해제 = 키 삭제(상속/기본값) */
  log: boolean;
  /** 3값 — "해제 = 키 삭제" 로는 상위가 켠 것을 이 호스트만 끌 수 없다. `""` = 상속 · `"on"` · `"off"` */
  shellIntegration: "" | "on" | "off";
  /** 해제 = 키 삭제. 켜면 `onConnect` 는 실행되지 않는다 (docs/log/2026-09-16-tmux-toggle.md) */
  tmux: boolean;
  /** 위 계층이 켠 호스트를 끄면 `agent = false` 를 적는다 */
  agent: boolean;
  /** 에이전트 id → 이 호스트 자기 값. 키 없음 = 상속, `""` = "붙이지 않음"으로 위 계층을 덮는다 */
  agentArgs: Record<string, string>;
  /** 빈 목록 = 키 삭제. 저장 직전 `parseForwardRows`(Rust 와 같은 규칙)로 파싱한다 */
  forwards: ForwardRow[];
  /**
   * AI 권한 — 헤드리스와 이 호스트의 창 타일에 걸린다. 따로 커밋되고 실패해도 호스트 저장은 되돌리지 않는다.
   * 모두 꺼지면 블록이 사라진다("끔" = "위임 없음"). 의존 규칙은 저장 직전 `withDependencies` 가 한 번 더 접는다.
   */
  delegation: DelegationGrants;
}

const emptyForm = (): HostForm => ({
  name: "",
  hostName: "",
  user: "",
  port: null,
  identityFile: "",
  identitiesOnly: false,
  forwardAgent: false,
  proxyJump: "",
  color: "",
  icon: "",
  group: "",
  tags: [],
  scrollback: null,
  onConnect: "",
  log: false,
  shellIntegration: "",
  tmux: false,
  agent: false,
  agentArgs: {},
  forwards: [],
  delegation: noGrants(),
});

/** 룬 모듈은 재대입되는 `$state` 를 export 할 수 없어 비우는 것도 필드 덮어쓰기다 */
export const hostForm = $state<HostForm>(emptyForm());

export function resetForm(): void {
  Object.assign(hostForm, emptyForm());
}

export const formUi = $state<{
  firstField: HTMLInputElement | null;
  /** 에이전트 id → Rust `agent_launch_preview` 가 낸 어긋남 — Rust 도 저장 때 같은 규칙으로 거절한다 */
  argsError: Record<string, string | null>;
}>({ firstField: null, argsError: {} });

export function inheritedHint(value: string | number | null | undefined): string | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  return t("files.host.inherited", { value });
}

export function hostFormProblemText(problem: HostFormProblem): string {
  switch (problem.kind) {
    case "name":
      return t("files.host.form.name");
    case "hostname":
      return t("files.host.form.hostname");
    case "port":
      return t("files.host.form.port");
    case "scrollback":
      return t("files.host.form.scrollback", { min: MIN_SCROLLBACK, max: MAX_SCROLLBACK });
  }
}
