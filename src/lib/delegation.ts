/**
 * **AI 권한(`~/.aynx/delegation.toml`) 의 프런트 쪽 얇은 통로** — 네 개의 `invoke` 와 권한 규칙
 * (단계 셈 · 단계 → 권한 · 의존 접기)뿐이다 (docs/log/2026-09-21-fleet-delegation-ui.md).
 *
 * ## 원격 세션의 AI 권한 = 호스트 하나의 단계 (2026-10-07)
 *
 * 예전에는 이 파일이 **헤드리스 세션에만** 걸렸고, 사람이 연 창 타일은 타일마다 "AI 읽기 허용" 을
 * 따로 켰다 — 그 토글이 읽기와 작업안 대상 자격을 함께 열었고, 자동 승인은 창 대상의 호스트 권한을
 * 아예 보지 않았다. 지금은 **원격(SSH) 세션의 권한이 별칭 하나의 블록**이다: 같은 호스트의 창 타일
 * 셋과 헤드리스 세션이 모두 같은 단계를 따른다. 로컬 타일은 실행 권한이 없고 타일별 "AI 읽기 허용"
 * 하나만 남는다(`ai.svelte.ts`).
 *
 * 단계는 **누적 다섯**이다: `off` < `read`(읽기 전용) < `approve`(승인 후 실행) < `auto`(자동 승인 실행) <
 * `all`(모두 승인 — 2026-10-23, docs/log/2026-10-23-approve-all.md). 저장 형식은 불리언 그대로이고([`DelegationGrants`]),
 * 판정이 누적이다 — 읽기 = `read`, 작업안 대상 = `read && propose`, 자동 실행 = `read && propose && auto_execute`,
 * 모두 승인 = 자동 실행 `&& approve_all`. 옛 파일의 비누적 조합도 이 규칙으로 읽힌다(마이그레이션 없음 — [`stageOf`]).
 *
 * 적는 길은 사람의 손 하나다 — 호스트 폼의 AI 칸과 타일 머리줄의 권한 팝오버가 여기를 지나 Rust 로
 * 간다. **MCP 에는 대응하는 도구가 없다**(승인 명령과 같은 규칙 — AI 는 자기 권한을 넓힐 표면이 없다).
 *
 * **신원 스냅샷(어느 서버인가)은 여기 없다.** 그 값은 Rust 가 저장하는 순간 `~/.ssh/config`
 * 에서 계산하고, 나중에 검사하는 것도 Rust 다 — 한 함수를 지나야 "적어 둔 것" 과 "검사하는
 * 것" 이 어긋나지 않는다. 프런트가 그 값을 쥐면 그 순간부터 신원 그물이 사용자 입력이 된다.
 *
 * 이 모듈은 **순수 모듈**이다(룬 없음) — 앱이 들고 있는 사본은 `app/delegation.svelte.ts` 다.
 */

import { invoke } from "./ipc";
import type { Key } from "$lib/i18n/keys";

/**
 * 권한 다섯 — Rust `DelegationGrants` 와 1:1 (snake_case 그대로, `HostMeta` 와 같은 관례).
 *
 * 앞의 셋이 **단계**를 이룬다(누적 — [`stageOf`]):
 * - `read` — AI 가 이 호스트의 세션(창 타일 · 헤드리스)을 **본다**.
 * - `propose` — AI 가 이 호스트를 **작업안의 대상**으로 올릴 수 있다(`read` 가 함께 있어야 뜻이 있다).
 * - `auto_execute` — 자동 승인 범위 안의 작업안이 **사람을 기다리지 않는다**(`propose` 위에서만).
 * - `approve_all` — **모두 승인**: 이 호스트만 대상인 작업안은 명령을 가리지 않고 사람을 기다리지 않는다(`auto_execute`
 *   위에서만 · 전체 스위치 `[automation] auto_approve` 와 caps 는 그대로 본다).
 *
 * 뒤의 둘은 **헤드리스 묶음**이다:
 * - `connect` — 앱이 타일 없이 이 호스트에 **붙는다**. 단계가 `approve` 이상일 때만 켤 수 있다
 *   (헤드리스로 붙어서 할 일이 작업안 실행뿐이다). 작업안·자동 실행 자체는 이것과 무관하다 —
 *   창 타일은 이미 붙어 있다.
 * - `vault_passphrase` — 이 호스트의 **헤드리스 접속에만** 볼트에 담긴 키 암호구를 쓴다
 *   (2026-09-22). 기본 불변("헤드리스는 볼트를 쓰지 않는다")을 없애는 것이 아니라 **호스트
 *   하나만큼 좁히는** 칸이고, 열리는 것은 키 암호구뿐이다 — 비밀번호는 여전히 아니다
 *   (docs/log/2026-09-22-delegation-vault-passphrase.md). `connect` 위에서만.
 */
export interface DelegationGrants {
  connect: boolean;
  read: boolean;
  propose: boolean;
  auto_execute: boolean;
  /** 모두 승인(2026-10-23) — 옛 백엔드는 이 칸을 안 보낸다(= 끔). 그래서 선택이다 */
  approve_all?: boolean;
  vault_passphrase: boolean;
}

/** `delegation_list_targets` 한 줄 — 권한 다섯에 별칭과 클라이언트(`any`·`claude`·`codex`)를 더한 것 */
export interface DelegationTargetView extends DelegationGrants {
  alias: string;
  client: string;
  /**
   * 이 별칭이 아직 `~/.ssh/config` 에 **있는가** — 거짓이면 **고아 위임**이다(호스트
   * 이름을 바꾸면 옛 블록이 남아 영영 붙지 않는다). 설정을 못 읽었으면 전부 참이다
   * ("모른다" 를 고아로 칠하지 않는다 — Rust `ssh_config::config_index`).
   *
   * **선택**이다: 옛 백엔드는 이 칸을 안 보내고, 그때는 아무것도 고아가 아니어야 한다.
   * 판정은 언제나 `=== false` 로 한다 (`console/delegation-rows.ts` 의 같은 칸과 같은 규칙).
   */
  alias_known?: boolean;
}

/** 아무것도 위임하지 않은 상태 — 폼의 빈 값이자 "블록을 지운다" 의 뜻이다 */
export function noGrants(): DelegationGrants {
  return { connect: false, read: false, propose: false, auto_execute: false, approve_all: false, vault_passphrase: false };
}

/** 다섯 중 하나라도 켜져 있는가 (하나도 없으면 파일에 블록을 남기지 않는다) */
export function anyGrant(g: DelegationGrants): boolean {
  return g.connect || g.read || g.propose || g.auto_execute || !!g.approve_all || g.vault_passphrase;
}

/** 두 위임이 같은가 — [저장]이 `delegation.toml` 을 건드릴지 말지를 이 한 줄로 정한다 */
export function sameGrants(a: DelegationGrants, b: DelegationGrants): boolean {
  return (
    a.connect === b.connect &&
    a.read === b.read &&
    a.propose === b.propose &&
    a.auto_execute === b.auto_execute &&
    !!a.approve_all === !!b.approve_all &&
    a.vault_passphrase === b.vault_passphrase
  );
}

/**
 * **의존 규칙을 적용한** 권한 — 단계는 누적이고(`approve_all ⊂ auto ⊂ propose ⊂ read`), 헤드리스 묶음은
 * `볼트 암호구 ⊂ 접속 ⊂ (단계 ≥ approve)` 다.
 *
 * 화면은 아래 칸을 재워 애초에 어긋난 조합을 만들지 못하게 하지만, **단계를 내리는 순간**은 다르다:
 * `approve` 에서 `read` 로 내리면 접속이 켜진 채 남는다. 그래서 저장하는 자리가 이 함수 하나를
 * 지난다 (Rust 의 `set_target` 이 같은 규칙으로 한 번 더 접는다 — 저쪽은 파일의 그물이고 이쪽은
 * 화면의 규칙이다).
 */
export function withDependencies(g: DelegationGrants): DelegationGrants {
  const read = g.read;
  const propose = read && g.propose;
  const connect = propose && g.connect;
  const auto_execute = propose && g.auto_execute;
  return {
    connect,
    read,
    propose,
    auto_execute,
    approve_all: auto_execute && !!g.approve_all,
    vault_passphrase: connect && g.vault_passphrase,
  };
}

// ---------------------------------------------------------------------------
// AI 권한 단계 (2026-10-07 — 원격 세션의 권한을 호스트 하나로)
// ---------------------------------------------------------------------------

/**
 * 원격 호스트의 **AI 권한 단계** — 누적 다섯. 글자는 코드 식별자라 화면에 보이지 않는다
 * (이름은 i18n `app.ai.stage.*`). `all` = 모두 승인(2026-10-23 — 고르면 확인 상자가 먼저 선다 · [`stageNeedsConfirm`]).
 */
export type AiStage = "off" | "read" | "approve" | "auto" | "all";

/** 낮은 것부터 — 라디오·세그먼트 버튼이 이 순서로 선다 */
export const AI_STAGES = ["off", "read", "approve", "auto", "all"] as const satisfies readonly AiStage[];

/**
 * 단계 → 이름 키 (`app.ai.stage.*`) — 키를 글자로 이어 붙이지 않게 표로 둔다(오타를 `check` 가 잡는다).
 * 이름은 **모든 언어에서 같은 짧은 영어 낱말**(Off · Read · Ask · Auto · YOLO — 2026-10-23)이라 넓은 자리 · 좁은 자리(칩 · 게이지 눈금)가
 * 이 표 하나를 쓴다. 뜻은 [`AI_STAGE_DESC`](번역)가 말한다.
 */
export const AI_STAGE_NAME: Readonly<Record<AiStage, Key>> = {
  off: "app.ai.stage.off",
  read: "app.ai.stage.read",
  approve: "app.ai.stage.approve",
  auto: "app.ai.stage.auto",
  all: "app.ai.stage.all",
};

/** 단계 → 설명 줄 키 (라디오·세그먼트 아래 한 줄) */
export const AI_STAGE_DESC: Readonly<Record<AiStage, Key>> = {
  off: "app.ai.stage.off.desc",
  read: "app.ai.stage.read.desc",
  approve: "app.ai.stage.approve.desc",
  auto: "app.ai.stage.auto.desc",
  all: "app.ai.stage.all.desc",
};

/**
 * 이 단계로 **올릴 때** 확인 상자가 먼저 서야 하는가 — 모두 승인(`all`)으로 새로 올라갈 때만(이미 `all` 이면 다시 묻지 않는다).
 * 확인은 앱 안 모달(`app/approve-all-confirm.ts`)이다. **순수.**
 */
export function stageNeedsConfirm(from: AiStage, to: AiStage): boolean {
  return to === "all" && from !== "all";
}

/**
 * 권한 다섯 → 단계 — **누적 규칙의 가장 높은 단계**다. 위임이 없으면(`null`) `off`.
 *
 * 옛 파일의 비누적 조합(예: `read` 없이 `propose`)은 그대로 이 규칙으로 읽힌다 — `propose` 만
 * 켜진 블록은 `off` 다(Rust 의 판정과 같은 결론이라 화면이 실제보다 넓게 말하지 않는다).
 */
export function stageOf(g: DelegationGrants | null | undefined): AiStage {
  if (!g || !g.read) return "off";
  if (!g.propose) return "read";
  if (!g.auto_execute) return "approve";
  return g.approve_all ? "all" : "auto";
}

/** `a` 가 `b` 이상인가 — "읽기 이상" · "승인 후 실행 이상" 을 한 줄로 */
export function stageAtLeast(a: AiStage, b: AiStage): boolean {
  return AI_STAGES.indexOf(a) >= AI_STAGES.indexOf(b);
}

/**
 * 단계 하나를 고른 결과의 권한 — 단계 넷(`read`·`propose`·`auto_execute`·`approve_all`)은 단계에서 오고,
 * 헤드리스 묶음(`connect`·`vault_passphrase`)은 **있던 값을 지키되** 의존을 접는다(단계가 `approve`
 * 아래로 내려가면 둘 다 꺼진다). `client` 는 이 모양에 없다 — Rust 가 블록의 모르는 키를 그대로 둔다.
 */
export function withStage(g: DelegationGrants | null | undefined, stage: AiStage): DelegationGrants {
  const base = g ?? noGrants();
  return withDependencies({
    connect: base.connect,
    vault_passphrase: base.vault_passphrase,
    read: stageAtLeast(stage, "read"),
    propose: stageAtLeast(stage, "approve"),
    auto_execute: stageAtLeast(stage, "auto"),
    approve_all: stage === "all",
  });
}

/**
 * 권한 한 줄 요약 — `읽기 전용` · `승인 후 실행 · 헤드리스 접속 · 볼트 암호구` 처럼 **단계 이름 + 켜진
 * 헤드리스 칸**. 호스트 목록의 표식·대시보드 묶음 칩의 말풍선이 함께 쓴다(두 자리가 다른 말을 하지 않게).
 * 문구 함수는 인자로 받는다(이 모듈은 i18n 상태를 들여오지 않는다).
 */
export function grantSummary(g: DelegationGrants, tr: (key: Key) => string): string {
  const parts = [tr(AI_STAGE_NAME[stageOf(g)])];
  const dep = withDependencies(g);
  if (dep.connect) parts.push(tr("app.ai.headless"));
  if (dep.vault_passphrase) parts.push(tr("app.ai.vault"));
  return parts.join(" · ");
}

/**
 * 이 타일이 **AI 권한을 받을 수 있는 원격 타일**이면 그 별칭 — 아니면 `null`.
 *
 * SSH 타일이고, 빠른 접속(`adhoc`)이 아니어야 한다: 빠른 접속의 `alias` 는 설정의 별칭이 아니라
 * 화면 이름(`user@host:port`)이라 `delegation.toml` 에 블록이 설 자리가 없다 — 그 타일의 권한은
 * **`off` 고정**이다("호스트로 저장하면 AI 권한을 줄 수 있습니다"). 이 값이 곧 `report_session` 의
 * `hostAlias` 다(Rust 가 이 별칭으로 권한을 읽는다).
 *
 * 인자는 `PaneSpec` 의 세 칸만 받는다 — 이 모듈이 세션 층을 들여오지 않게.
 */
export function aiHostAlias(pane: { kind: string; alias?: string; adhoc?: unknown }): string | null {
  if (pane.kind !== "ssh" || pane.adhoc) return null;
  const alias = pane.alias?.trim() ?? "";
  return alias === "" ? null : alias;
}

/**
 * 지금 위임된 대상 전부. **실패는 삼킨다**(빈 목록) — 위임 표식 하나 때문에 호스트 목록이
 * 무너지면 안 된다 (`console/sessions.ts` 와 같은 원칙).
 */
export async function listDelegationTargets(): Promise<DelegationTargetView[]> {
  try {
    return (await invoke<DelegationTargetView[]>("delegation_list_targets")) ?? [];
  } catch {
    return [];
  }
}

/**
 * 별칭 하나의 권한을 저장한다 — 다섯이 모두 꺼져 있으면 **블록을 지운다**(죽은 블록 금지).
 * 여기만 오류를 던진다: 사람이 [저장]·단계 버튼을 눌러 시킨 일이라 조용히 실패하면 안 된다.
 * 성공하면 Rust 가 `delegation-changed` 를 모든 창에 알린다(`app/delegation.svelte.ts` 가 다시 읽는다).
 */
export function setDelegationTarget(alias: string, grants: DelegationGrants): Promise<void> {
  return invoke<void>("delegation_set_target", { alias, grants: withDependencies(grants) });
}

/** 이름 변경 팬아웃 — `alias` 한 칸만 옮긴다(서버는 그대로). 위임이 없던 호스트면 `false` */
export function renameDelegationTarget(from: string, to: string): Promise<boolean> {
  return invoke<boolean>("delegation_rename_target", { from, to });
}

/** 제거 팬아웃 — 별칭들의 블록을 걷어내고 지운 개수를 돌려준다 */
export function removeDelegationTargets(aliases: readonly string[]): Promise<number> {
  return invoke<number>("delegation_remove_targets", { aliases: [...aliases] });
}
