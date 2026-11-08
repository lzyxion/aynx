// 호스트 **폼의 모양** — `HostForm` 칸 · 빈 폼 · 폼 객체(`hostForm`, 마크업의 `bind:` 대상) · DOM 참조 · 문구 조각.
// 폼의 수명(열기·닫기·저장)과 그 세션 상태는 `form.svelte.ts`. `resetForm` · `hostFormProblemText` 는 내부 전용.
import { noGrants, type DelegationGrants } from "$lib/delegation";
import { t } from "$lib/i18n/i18n.svelte.js";
import type { HostFormProblem } from "$lib/host-form-tabs";
import type { ForwardRow } from "$lib/forward";
import { MAX_SCROLLBACK, MIN_SCROLLBACK } from "$lib/session";

// ---------------------------------------------------------------------------
// ssh config 편집 진입점
//
// `~/.ssh/config` 는 ssh·scp·VS Code 와 공유하는 원본이라 앱이 파일 전체를 재작성하지
// 않는다. 추가는 파일 끝 append, 수정은 그 호스트의 Host 블록만 국소 패치(블록 밖은 불변),
// 삭제는 에디터에 넘긴다. 두 모달은 같은 폼을 공유한다.
// ---------------------------------------------------------------------------

/**
 * 폼 상태. 두 파일을 한 폼에서 다룬다 — 위쪽 5개는 `~/.ssh/config`(접속에 필요한 값),
 * 아래 7개는 `~/.ssh/sessions.toml`(앱 전용 표시·동작).
 * 숫자 칸은 `<input type="number">` 바인딩이 빈 값을 `null` 로 준다. `color` 는 `""` 가
 * "값 없음"(= 상속/기본값)이고, `tags` 는 쉼표로 구분한 한 줄이다.
 */
export interface HostForm {
  name: string;
  hostName: string;
  user: string;
  port: number | null;
  identityFile: string;
  /**
   * **이 키만 사용**(`IdentitiesOnly`). 켜면 `IdentitiesOnly yes` 한 줄이 이 블록에 적히고,
   * 끄면 그 줄이 사라진다(= `Host *` 상속으로 되돌아간다 — `false` 를 적지 않는다).
   *
   * `IdentityFile` 이 비어 있으면 **켤 수 없다** — 그 상태에서는 OpenSSH 도 기본 키 이름을
   * 그대로 쓰므로 "위 키만 시도" 가 거짓말이 된다. 화면이 스위치를 재우고, 값은
   * `identitiesOnlyFor` 가 한 번 더 접는다.
   */
  identitiesOnly: boolean;
  /**
   * **에이전트 포워딩** (`ssh -A`). 스위치는 **접속이 실제로 볼 값**으로 선다 — `sessions.toml`
   * 의 덮어쓰기가 있으면 그것, 없으면 `~/.ssh/config` 의 `ForwardAgent`([`forwardAgentOn`]).
   * 저장할 때 config 와 같은 값이면 덮어쓰기를 지운다([`forwardAgentPatch`]) — 그래서 "접속"
   * 탭에 있어도 `~/.ssh/config` 가 아니라 `sessions.toml` 에 적힌다 (docs/log/2026-09-23-agent-forwarding.md).
   */
  forwardAgent: boolean;
  /**
   * **경유 호스트**(`ProxyJump`). `""` = 직접 접속(= 그 줄을 지운다).
   *
   * 값은 대개 다른 호스트의 별칭이지만, 사람이 파일에 `user@bastion:2222` 처럼 적어 둔
   * 글자일 수도 있다 — 그때도 고르개가 그 글자를 **선택된 항목 하나로** 들고 있어서 저장할
   * 때 조용히 사라지지 않는다 ([`jumpOptions`]).
   */
  proxyJump: string;
  color: string;
  /** 이모지 아이콘 한 글자. 빈 문자열 = 키 삭제(상속/없음) — `color` 와 같은 규칙 */
  icon: string;
  group: string;
  /**
   * 태그들 — **칩 하나가 한 칸**이다 (`TagInput.svelte`). 다듬어졌고, 비어 있지 않고,
   * 겹치지 않는다: 그 규칙은 칩을 만드는 자리(`tag-input.ts`)가 지키므로 [저장]은 이
   * 배열을 **그대로** 보낸다. 예전에는 쉼표로 구분된 한 줄이라, 사람이 친 글자가 실제로
   * 무엇이 될지는 저장해 봐야 알았다 (docs/log/2026-09-20-host-form-tabs.md).
   */
  tags: string[];
  scrollback: number | null;
  onConnect: string;
  /** 세션 로깅. 체크 해제 = 키 삭제(상속/기본값) — `HostMetaPatch.log` 주석 참고 */
  log: boolean;
  /**
   * 셸 통합 주입. **체크박스가 아니라 3값**인 이유: "해제 = 키 삭제" 로는 `false` 를 적을
   * 수 없는데, 이 칸의 존재 이유가 바로 "상위 계층이 켜 놨어도 이 호스트만 끄기" 다.
   * `""` = 키 삭제(상속) · `"on"` = `true` · `"off"` = `false`.
   */
  shellIntegration: "" | "on" | "off";
  /**
   * **tmux 로 접속.** `log` 와 같은 체크박스다 — 해제 = 키 삭제(기본이 꺼짐이라 `false` 를
   * 파일에 남길 이유가 없다). 켜면 `onConnect` 는 실행되지 않고, 그 타일은 "화면만 있는
   * 세션"(간이 모드)이 된다 (docs/log/2026-09-16-tmux-toggle.md).
   */
  tmux: boolean;
  /**
   * **에이전트 활성화** (에이전트 칸 — 2026-10-26, 옛 "원격 AI 훅 자동 설치") — 기본 끔. 켜면 `agent = true` 가 적히고,
   * 위 계층이 켠 호스트를 끄면 `agent = false`(`HostMetaPatch.agent`).
   */
  agent: boolean;
  /**
   * **원격 추가 인자** — 에이전트 id → 이 호스트 **자기 값**. 키가 없으면 상속(칸은 비고 곁말이 출처를 말한다), `""` 는
   * "붙이지 않음"으로 위 계층을 덮는다. 칸에 적는 순간 자기 값이 되고, ↺ 가 키를 지워 상속으로 되돌린다.
   */
  agentArgs: Record<string, string>;
  /**
   * **포트 포워딩 프리셋** — 접속하면 자동으로 여는 줄들 (`tags` 처럼 목록 전체가 곧 저장
   * 상태다: 빈 목록 = 키 삭제). 포트 칸이 `number | null` 인 것은 `<input type="number">` 가
   * 빈 칸을 `null` 로 주기 때문이고, 그래서 저장 직전에 한 번 파싱한다
   * (`forward.ts` 의 `parseForwardRows` — Rust 와 같은 규칙).
   */
  forwards: ForwardRow[];
  /**
   * **AI 권한** — 이 호스트에서 AI 가 무엇을 할 수 있는가 (`~/.aynx/delegation.toml`). 2026-10-07 부터
   * 헤드리스만이 아니라 이 호스트의 **창 타일**에도 걸린다(단계 넷 — `$lib/delegation` 의 `stageOf`).
   *
   * 앞의 칸들과 **파일이 다르다**(세 번째 파일이다): `~/.ssh/config` 도 `sessions.toml` 도
   * 아니라 앱이 AI 에게 준 사전 정책이 사는 자리다. 그래서 [저장]에서도 따로 커밋되고,
   * 거기서 실패해도 **호스트 저장 자체는 되돌리지 않는다** ([`submitForm`]).
   *
   * 다섯이 모두 꺼지면 파일에서 블록이 사라진다 — "끔" 과 "위임 없음" 은 같은 상태다.
   * 의존 규칙(단계는 누적 · `볼트 암호구 ⊂ 헤드리스 접속 ⊂ 단계 ≥ 승인 후 실행`)은 화면이 칸을 재워
   * 지키고, 저장 직전 `withDependencies` 가 한 번 더 접는다 (`$lib/delegation.ts`).
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

/**
 * 추가·수정이 **같은 폼**을 쓴다 (동시에 뜰 일이 없다). 마크업이 `bind:` 로 직접 잡으므로
 * 객체 한 칸으로 내보낸다 — 룬 모듈은 재대입되는 `$state` 를 export 할 수 없어서, 폼을
 * 비우는 것도 새 객체 대입이 아니라 필드 덮어쓰기다 ([`resetForm`]).
 */
export const hostForm = $state<HostForm>(emptyForm());

export function resetForm(): void {
  Object.assign(hostForm, emptyForm());
}

/**
 * 폼이 잡는 DOM 참조 (`bind:this`). ⓘ 의 펼침 불 다섯은 2026-09-28 에 사라졌다 — 설명이 팝오버가
 * 되어 열림은 `settings/note-popover.svelte.ts` 의 칸 하나가 쥔다.
 */
export const formUi = $state<{
  firstField: HTMLInputElement | null;
  /**
   * 에이전트 칸의 **추가 인자 판정** — 에이전트 id → Rust 미리보기(`agent_launch_preview`)가 낸 어긋남(없으면 `null`).
   * 화면이 칸을 적을 때마다 채우고, [저장]이 걸린 칸이 있으면 그 칸으로 데려간다(Rust 도 저장 때 같은 규칙으로 거절한다).
   */
  argsError: Record<string, string | null>;
}>({ firstField: null, argsError: {} });

/** 상속값 힌트 한 줄 (원본에 값이 없을 때만 보여준다) */
export function inheritedHint(value: string | number | null | undefined): string | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  return t("files.host.inherited", { value });
}

/** 검증이 낸 갈래를 화면 문구로 — 자리표시자가 있는 것은 스크롤백 하나뿐이다 */
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
