// 호스트 **폼의 수명** — 열기(추가·수정·이름 변경) · 닫기 · 저장(`submitForm`: config → sessions.toml → 이름 팬아웃 → 위임)
// · 포워딩 프리셋 줄. 폼 세션 상태(`mode` · `editOriginal` · 오류 · 원본 메타 …)는 **여기에만** 산다 — 다시 대입되는
// 룬이라 대입하는 함수들과 한 파일이어야 한다(형제는 게터로만 읽는다).
import { showNotice } from "$lib/app/notice";
import { hostAliasRenamed } from "$lib/app/host-rename";
import { refreshDelegationTargets } from "$lib/app/delegation.svelte.js";
import {
  listDelegationTargets,
  noGrants,
  sameGrants,
  setDelegationTarget,
  withDependencies,
  type DelegationGrants,
} from "$lib/delegation";
import { rememberFocusOrigin, returnFocus } from "$lib/app/focus-return.svelte.js";
import { syncPresetForwards } from "$lib/app/forwards.svelte.js";
import { t } from "$lib/i18n/i18n.svelte.js";
import { validateHostForm, type HostFormTab } from "$lib/host-form-tabs";
import { promptsBlocking } from "$lib/app/prompts.svelte.js";
import {
  addHost,
  editHost,
  emptyHostMetaPatch,
  getHostMeta,
  hostMeta,
  identitiesOnlyFor,
  loadHosts,
  forwardAgentOn,
  forwardAgentPatch,
  setHostMeta,
  type HostEntry,
  type HostMeta,
  type HostMetaPatch,
} from "$lib/hosts";
import { emptyForwardRow, forwardRowOf, parseForwardRows } from "$lib/forward";
import { refreshHosts } from "./list.svelte.js";
import { formUi, hostForm, hostFormProblemText, resetForm } from "./form-model.svelte.js";
import { refreshSavedCreds, savedCreds } from "./saved-creds.svelte.js";
import { ensureLogsFolder } from "./session-logs.svelte.js";

/**
 * 포커스 복귀 이름표 (`app/focus-return`) — 폼을 닫으면 키보드가 원래 있던 자리로 돌아간다.
 * 대개 독의 호스트 목록이지만(그쪽에서 열었으니까) 타일의 ⚙·F2 로 연 경우에는 그 타일이다.
 */
const FOCUS_HOST_FORM = "host-form";

/** `null` 이면 폼이 닫혀 있다 */
let mode = $state<"add" | "edit" | null>(null);
/** 수정 대상의 **원래** 별칭 — 고칠 블록을 찾는 열쇠 (별칭 자체를 바꿔도 유지된다) */
let editOriginal = $state("");
let formError = $state<string | null>(null);
/**
 * 그 오류가 가리키는 **칸의 요소 id** (없으면 `null`).
 *
 * 폼이 세 탭으로 갈리면서 생긴 자리다 (docs/log/2026-09-20-host-form-tabs.md): 오류 한 줄은
 * 탭 바깥이라 늘 보이는데 그 줄이 말하는 칸은 **안 보이는 탭**에 있을 수 있다. 문구와 함께
 * 칸을 내면 화면이 그 탭으로 데려간 뒤 칸에 포커스를 준다 (`tabOfField`).
 *
 * `formError` 를 건드리는 자리는 **전부** 이 값도 함께 건드린다 — 한쪽만 바꾸면 지난 오류의
 * 칸으로 데려가는 조용한 버그가 된다. 칸을 특정할 수 없는 실패(메타 저장)는 `null` 이다.
 */
let formErrorField = $state<string | null>(null);
/** 다음에 열리는 폼이 설 탭 — [`hostFormWantTab`] 머리말. 폼을 닫을 때 비운다 */
let wantTab = $state<HostFormTab | null>(null);
let saving = $state(false);
/**
 * "이름 변경" 진입 1회용 플래그 — 모달이 뜰 때 별칭 칸을 **전체 선택**까지 해 준다
 * (평소 진입은 포커스만).
 */
let selectNameOnce = false;

/**
 * 수정 대상의 **병합된** 메타데이터 — `[defaults]`·`preset` 까지 합친 표시용 값이다.
 * 폼을 채우는 데는 절대 쓰지 않고, 빈 칸의 placeholder 힌트("상속: 5000")로만 쓴다.
 */
let inherited = $state<HostMeta | null>(null);
/**
 * 이 호스트가 `IdentitiesOnly` 를 **물려받고만** 있는가 (`Host *` 등에서 켜졌고 자기 블록에는
 * 없다). 스위치는 자기 블록 값을 쥐므로 꺼져 보이는데 접속은 켜진 채라 — 그 어긋남을
 * 곁말 한 줄로 말한다 (메타 칸들의 "상속: …" 힌트와 같은 자리).
 */
let inheritedIdentitiesOnlyFlag = $state(false);
/**
 * 이 호스트의 `~/.ssh/config` 에 `ForwardAgent yes` 가 (병합값으로) 적혀 있는가. 스위치 옆
 * 곁말이 그 사실을 말하고, 저장은 이 값과 같으면 덮어쓰기를 지운다([`forwardAgentPatch`]).
 */
let configForwardAgentFlag = $state(false);
/** 수정 대상의 **원본** 메타데이터 (`[hosts.<별칭>]` 에 실제로 적힌 것). 별칭 변경 정리에 쓴다 */
let originalMeta = $state<HostMeta | null>(null);
/**
 * 폼을 열 때 파일에 적혀 있던 **AI 위임**. [저장]이 `delegation.toml` 을 건드릴지 말지를 이 값과의
 * 비교 하나로 정한다 — 위임을 손대지 않은 저장이 그 파일의 mtime 을 흔들 이유가 없고, 무엇보다
 * **설정에 없는 별칭**(고아)을 고치던 중 "config 에 없습니다" 로 막히지 않는다.
 */
let originalDelegation = $state<DelegationGrants>(noGrants());
/** 원본 메타 로드 순번 — 폼을 다시 열면 늦게 온 옛 응답이 새 폼을 덮어쓰지 않는다 */
let metaSeq = 0;
/**
 * 별칭 변경으로 config 는 이미 새 이름이 됐는데 옛 별칭의 메타 테이블 정리가 아직 안 끝난
 * 상태. (config 와 sessions.toml 은 파일이 둘이라 한 번에 커밋되지 않는다 — 재시도용 메모지다.)
 */
let staleMetaAlias: string | null = null;

export function hostFormMode(): "add" | "edit" | null {
  return mode;
}
export function hostFormOpen(): boolean {
  return mode !== null;
}
/** 호스트 키·비밀번호가 더 급하다 — 그 모달이 떠 있으면 폼은 기다린다 */
export function hostFormVisible(): boolean {
  return mode !== null && !promptsBlocking();
}
export function editOriginalName(): string {
  return editOriginal;
}
export function hostFormError(): string | null {
  return formError;
}
/** 그 오류가 가리키는 칸의 요소 id (`f-port`·`f-scrollback`·`f-forwards-label`·`f-name`) */
export function hostFormErrorField(): string | null {
  return formErrorField;
}
/**
 * 폼이 **어느 탭으로 열릴지** — 없으면 첫 탭(`connect`)이다.
 *
 * 폼은 열릴 때마다 첫 탭으로 되돌아간다(`HostForm.svelte` 의 `$effect`) — 여는 사람이 늘
 * 손대는 칸이 거기 있기 때문이다. 그런데 **어디서 왔는지가 이미 칸을 정하는** 길이 하나
 * 생겼다: 설정 › 보안의 AI 권한 표에서 [호스트 설정…]을, 원격 타일의 권한 팝오버에서 "호스트
 * 설정 › AI" 를 누르면 보러 가는 것이 AI 칸이다(2026-10-07 전엔 세션 탭의 위임 스위치). 그때만
 * 이 칸이 차고, 폼이 열리는 순간 그 탭이 선다
 * (docs/log/2026-09-21-fleet-delegation-ui.md).
 *
 * `hostFormErrorField` 와 같은 결의 게시판 한 칸이다 — 여는 쪽이 적고 폼이 읽는다.
 */
export function hostFormWantTab(): HostFormTab | null {
  return wantTab;
}
export function hostFormSaving(): boolean {
  return saving;
}
export function inheritedMeta(): HostMeta | null {
  return inherited;
}
/** `IdentitiesOnly` 를 공용 블록에서 물려받고만 있는가 (스위치는 꺼져 있는데 접속은 켜진 상태) */
export function inheritedIdentitiesOnly(): boolean {
  return inheritedIdentitiesOnlyFlag;
}
/** `~/.ssh/config` 가 이 호스트에 `ForwardAgent yes` 를 주는가 (폼의 곁말 한 줄) */
export function configForwardAgent(): boolean {
  return configForwardAgentFlag;
}
/**
 * 원본 메타데이터를 아직 못 읽은 상태 (파일 읽기 한 번이라 보통 눈에 띄지 않는다).
 * 이때 저장하면 아직 비어 있는 메타 칸들이 파일에 그대로 덮어써지므로 저장을 막는다.
 */
export function metaLoading(): boolean {
  return mode === "edit" && originalMeta === null;
}

/**
 * 모달이 뜨면 첫 입력(별칭)에 포커스. "이름 변경" 진입이면 값을 전체 선택까지 한다(1회용).
 * `+page.svelte` 의 `$effect` 가 폼이 보이는 동안 부른다.
 */
export function focusHostForm(): void {
  formUi.firstField?.focus();
  if (selectNameOnce) {
    formUi.firstField?.select();
    selectNameOnce = false;
  }
}

/**
 * 추가 모달을 연다.
 *
 * `group` 은 트리가 실어 보내는 **지금 보고 있는 폴더**다. 그룹 칸만 미리 채우고
 * 나머지는 빈 폼 그대로다 — 폴더 안에서 만든 호스트가 그 폴더에 생기는 것이 탐색기의
 * 상식이고, 안 채우면 저장 직후 호스트가 홈으로 떨어져 사용자가 다시 끌어다 넣어야 한다.
 */
export function openAdd(group?: string): void {
  if (mode === null) rememberFocusOrigin(FOCUS_HOST_FORM);
  metaSeq += 1; // 열려 있던 수정 폼의 메타 로드가 새 폼에 떨어지지 않게
  resetForm();
  formUi.argsError = {};
  if (group) hostForm.group = group;
  editOriginal = "";
  inherited = null;
  inheritedIdentitiesOnlyFlag = false;
  configForwardAgentFlag = false;
  originalMeta = null;
  // 아직 없는 호스트에 위임이 있을 리 없다 — 켠 것이 하나라도 있으면 그것이 곧 변경이다.
  originalDelegation = noGrants();
  staleMetaAlias = null;
  formError = null;
  formErrorField = null;
  mode = "add";
  // 추가 폼에는 "저장된 자격증명" 줄이 없다 — 아직 없는 호스트의 값이 볼트에 있을 리 없다.
  savedCreds.password = false;
  savedCreds.passphrase = null;
  ensureLogsFolder();
}

/**
 * 세션 타일의 ⚙ · F2 — 현재 **적용 중인** 값으로 폼을 채운다.
 *
 * `HostEntry` 는 `Host *` 같은 패턴 블록까지 병합한 결과라서, 화면의 값이 이 호스트의
 * 블록에는 없는 줄일 수도 있다. 저장하면 그 값이 이 블록에 직접 적힌다.
 *
 * **메타데이터는 정반대로 다룬다** — `host.meta`(병합값)로 채우면 상속받던 값이 저장 순간
 * `[hosts.<별칭>]` 에 굳어 버린다. 그래서 폼은 `get_host_meta` 가 주는 **원본**으로 채우고
 * (파일 읽기라 비동기), 병합값은 빈 칸의 placeholder 힌트로만 쓴다.
 */
export async function openEdit(host: HostEntry, tab: HostFormTab | null = null): Promise<void> {
  if (mode === null) rememberFocusOrigin(FOCUS_HOST_FORM);
  resetForm();
  formUi.argsError = {};
  // **어느 탭으로 열 것인가** — 부르는 쪽이 보러 가는 칸을 알 때만 찬다(AI 권한 표의
  // [호스트 설정…] · 권한 팝오버의 "호스트 설정 › AI"). 폼을 닫을 때 `closeForm` 이 비운다.
  wantTab = tab;
  hostForm.name = host.name;
  hostForm.hostName = host.host_name ?? "";
  hostForm.user = host.user ?? "";
  hostForm.port = host.port ?? null;
  hostForm.identityFile = host.identity_file ?? "";
  // **자기 블록 값**이다 — 병합값(`identities_only`)으로 채우면 `Host *` 에서 물려받았을
  // 뿐인 값이 [저장] 한 번에 이 블록으로 굳는다 (메타데이터와 같은 규칙 — 아래 머리말).
  hostForm.identitiesOnly = host.identities_only_own === true;
  // 상속받은 값은 칸이 아니라 **곁말**로만 보인다 (다른 상속 칸과 같은 모양).
  inheritedIdentitiesOnlyFlag = host.identities_only === true && host.identities_only_own !== true;
  // 에이전트 포워딩 — 메타(덮어쓰기)를 읽기 전에는 config 의 값으로 서 있다(그 사이 저장은
  // `metaLoading` 이 막는다). 아래에서 원본 메타가 오면 덮어쓰기와 합친 값으로 다시 선다.
  configForwardAgentFlag = host.forward_agent === true;
  hostForm.forwardAgent = configForwardAgentFlag;
  hostForm.proxyJump = host.proxy_jump ?? "";
  editOriginal = host.name;
  inherited = hostMeta(host);
  originalMeta = null;
  originalDelegation = noGrants();
  staleMetaAlias = null;
  formError = null;
  formErrorField = null;
  mode = "edit";
  ensureLogsFolder();
  // 볼트 조회는 메타 읽기와 **독립**이다 — 둘 중 하나가 늦어도 다른 줄은 제때 선다.
  // (`config` 의 `IdentityFile` 은 이미 채워졌으므로 여기서 물을 수 있다.)
  savedCreds.password = false;
  savedCreds.passphrase = null;
  void refreshSavedCreds(host.name, hostForm.identityFile);

  const seq = ++metaSeq;
  // **AI 위임**은 세 번째 파일이라 따로 읽는다 (`delegation_list_targets`). 메타 읽기와 **독립**
  // 이라 기다리지 않는다 — 둘 중 하나가 늦어도 다른 칸은 제때 선다 (볼트 조회와 같은 모양).
  // 순번은 같은 것을 쓴다: 폼을 닫거나 다른 호스트를 열면 둘 다 함께 버려져야 한다.
  void loadDelegationForForm(host.name, seq);

  const raw = await getHostMeta(host.name);
  // 그 사이 폼을 닫았거나 다른 호스트를 열었으면 버린다.
  if (seq !== metaSeq) return;
  originalMeta = raw;
  hostForm.color = raw.color ?? "";
  hostForm.icon = raw.icon ?? "";
  hostForm.group = raw.group ?? "";
  // 배열 그대로 — 다만 **사본**이다 (`originalMeta` 가 든 그 배열을 폼이 직접 고치면
  // 저장 전 비교가 자기 자신과의 비교가 된다).
  hostForm.tags = [...raw.tags];
  hostForm.scrollback = raw.scrollback ?? null;
  hostForm.onConnect = raw.on_connect ?? "";
  hostForm.log = raw.log ?? false;
  // 3값이라 `?? false` 로 접을 수 없다 — 적히지 않음(`null`)과 `false` 는 다른 상태다.
  hostForm.shellIntegration =
    raw.shell_integration === true ? "on" : raw.shell_integration === false ? "off" : "";
  // `log` 와 같다 — 체크박스라 `null`(안 적음)과 `false`(끔)가 화면에서 같은 상태다.
  hostForm.tmux = raw.tmux ?? false;
  // 기본이 끔 — 자기 값이 없으면 상속값(병합된 `inherited`)이 스위치에 선다. 저장은 아래 `agent:` 줄이 거꾸로 접는다.
  hostForm.agent = (raw.agent ?? inherited?.agent) === true;
  // 자기 블록의 키만(사본) — 상속값은 칸이 아니라 곁말로만 보인다(`inheritedMeta().agent_args`).
  hostForm.agentArgs = { ...(raw.agent_args ?? {}) };
  // 덮어쓰기(원본)와 config 를 합친 **접속이 볼 값** — 저장은 거꾸로 접는다(`forwardAgentPatch`).
  hostForm.forwardAgent = forwardAgentOn(configForwardAgentFlag, raw.forward_agent);
  // 상속이 없는 칸이라 원본과 병합값이 같다 — 그래도 원본에서 읽는다 (다른 칸과 한 규칙).
  hostForm.forwards = raw.forwards.map(forwardRowOf);
  forwardRowError = null;
}

/**
 * 이 별칭의 **AI 위임**을 파일에서 읽어 폼과 비교 기준(`originalDelegation`)에 채운다.
 *
 * 실패는 `listDelegationTargets` 가 빈 목록으로 삼키므로 여기 갈래가 하나다 — 그때 폼은 "위임
 * 없음" 을 보이고, 사용자가 손대지 않으면 [저장]도 `delegation.toml` 을 건드리지 않는다
 * (`sameGrants` 비교가 그 자리를 지킨다).
 */
async function loadDelegationForForm(alias: string, seq: number): Promise<void> {
  const key = alias.trim().toLowerCase();
  const found = (await listDelegationTargets()).find((t) => t.alias.trim().toLowerCase() === key);
  if (seq !== metaSeq) return; // 그 사이 폼을 닫았거나 다른 호스트를 열었다
  const grants: DelegationGrants = found
    ? {
        connect: found.connect,
        read: found.read,
        propose: found.propose,
        auto_execute: found.auto_execute,
        approve_all: found.approve_all ?? false,
        vault_passphrase: found.vault_passphrase,
      }
    : noGrants();
  originalDelegation = grants;
  hostForm.delegation = { ...grants };
}

export function closeForm(): void {
  metaSeq += 1; // 아직 안 온 원본 메타 응답을 버린다
  mode = null;
  wantTab = null; // 다음에 여는 사람이 남의 탭에서 시작하지 않게
  formError = null;
  formErrorField = null;
  forwardRowError = null;
  returnFocus(FOCUS_HOST_FORM);
}

// ---------------------------------------------------------------------------
// 포트 포워딩 프리셋 줄 (docs/log/2026-09-17-forward-presets.md)
// ---------------------------------------------------------------------------

/**
 * 검증에 걸린 **줄 번호** (없으면 `-1`). 문구는 폼 아래 한 줄(`formError`)로 나가고,
 * 이 값은 그 줄의 `aria-invalid` 에만 쓴다 — 어느 줄인지 글자로만 말하면 줄이 넷일 때
 * 사람이 세어야 한다.
 */
let forwardRowError = $state<number | null>(null);

export function forwardRowInvalid(index: number): boolean {
  return forwardRowError === index;
}

/** 빈 줄 하나를 더한다 (원격 호스트는 `localhost` 로 미리 채워진다) */
export function addForwardRow(): void {
  hostForm.forwards.push(emptyForwardRow());
  forwardRowError = null;
}

export function removeForwardRow(index: number): void {
  hostForm.forwards.splice(index, 1);
  forwardRowError = null;
}

export async function submitForm(ev: SubmitEvent): Promise<void> {
  ev.preventDefault();
  if (saving || metaLoading()) return;

  // 지난 오류를 **먼저 비운다**. 문구만 보면 군더더기지만(어차피 곧 덮어쓴다) 칸 쪽은 다르다:
  // 같은 실수를 두 번 하면 `formErrorField` 의 값이 그대로라, 그 칸으로 데려가는 화면 쪽
  // 효과가 "값이 안 바뀌었다" 고 보고 다시 돌지 않는다 (다른 탭에 가 있어도 그대로 선다).
  // 사이에 `await` 가 없어 화면에는 비워진 순간이 보이지 않는다.
  formError = null;
  formErrorField = null;

  // 칸 넷(별칭·호스트 주소·포트·스크롤백)을 프런트에서 미리 걸러 낸다 — 규칙은 순수 함수
  // 하나다 (`host-form-tabs.ts` 의 `validateHostForm`, 왜 별칭까지 보는지는 그 머리말).
  // 나머지 규칙은 백엔드가 단일 진실이다.
  const port = hostForm.port;
  const scrollback = hostForm.scrollback;
  const problem = validateHostForm(hostForm);
  if (problem !== null) {
    formError = hostFormProblemText(problem);
    formErrorField = problem.field;
    return;
  }

  // 원격 추가 인자 — 화면이 Rust 미리보기로 받아 둔 어긋남(`formUi.argsError`). 저장은 원자적이라 Rust 도 같은 규칙으로
  // 거절하지만, 그 사실을 config 를 쓴 뒤에 알리면 "메타만 실패" 로 흐려진다 — 그 칸으로 먼저 데려간다.
  for (const [id, error] of Object.entries(formUi.argsError)) {
    if (error && id in hostForm.agentArgs) {
      formError = error;
      formErrorField = `f-agent-args-${id}`;
      return;
    }
  }

  // 포워딩 프리셋 — 백엔드와 **같은 규칙**을 여기서 한 번 더 본다 (`forward.ts`).
  // 저장은 원자적이라 한 줄이라도 틀리면 파일에 한 글자도 닿지 않는다: 그 사실을 왕복
  // 뒤에 알리면 어느 줄이 문제인지가 흐려진다.
  const parsedForwards = parseForwardRows(hostForm.forwards, t);
  if (!parsedForwards.ok) {
    formError = parsedForwards.error;
    // 칸이 여럿인 줄이라 id 는 **줄의 이름표**다 — 어느 칸인지는 `aria-invalid` 가 말한다.
    formErrorField = "f-forwards-label";
    forwardRowError = parsedForwards.index;
    return;
  }
  forwardRowError = null;

  const payload = {
    name: hostForm.name,
    host_name: hostForm.hostName,
    user: hostForm.user.trim() || null,
    port,
    identity_file: hostForm.identityFile.trim() || null,
    // 키 파일을 비운 채 켜 둔 스위치는 **거짓으로 접는다** (`identitiesOnlyFor` 의 머리말 —
    // 화면이 재운 뒤에 칸만 비우고 저장하는 길이 있다). 거짓이면 그 줄을 지운다.
    identities_only: identitiesOnlyFor(hostForm.identitiesOnly, hostForm.identityFile),
    // "(없음)" = 빈 문자열 = 그 줄을 지운다 (다른 칸의 "비우기" 와 같은 규칙).
    proxy_jump: hostForm.proxyJump.trim() || null,
  };

  // sessions.toml 은 우리 소유라 열 칸의 **완전한 상태**를 그대로 보낸다 (빈 칸 = 키 삭제).
  const patch: HostMetaPatch = {
    color: hostForm.color.trim() || null,
    icon: hostForm.icon.trim() || null,
    group: hostForm.group.trim() || null,
    // 칩이 이미 다듬어 둔 배열이다 (`TagInput` · `tag-input.ts`) — 여기서 다시 쪼개지 않는다.
    tags: hostForm.tags,
    scrollback,
    on_connect: hostForm.onConnect.trim() || null,
    log: hostForm.log,
    // `끔` 만 파일에 `false` 로 적힌다 — `기본` 은 다른 빈 칸과 같이 키를 지운다.
    shell_integration:
      hostForm.shellIntegration === "on" ? true : hostForm.shellIntegration === "off" ? false : null,
    // `log` 와 같다 — 해제는 "끔" 이 아니라 "안 적음" 이라 키가 사라진다.
    tmux: hostForm.tmux,
    // `tags` 와 같다 — 목록 전체가 곧 상태이고, 빈 목록은 키를 지운다.
    forwards: parsedForwards.presets,
    // config 의 `ForwardAgent` 와 같으면 적지 않는다(null) — 다를 때만 덮어쓴다.
    forward_agent: forwardAgentPatch(hostForm.forwardAgent, configForwardAgentFlag),
    // 기본이 끔 — 켬은 `true`, 끔은 열 때 켜져 있었을 때만 `false`(위 계층의 켬을 덮는다), 아니면 키 삭제.
    agent: hostForm.agent ? true : inherited?.agent === true ? false : null,
    // 자기 값만 — 없는 키는 상속, `""` 는 붙이지 않음. 빈 객체는 키 삭제다.
    agent_args: Object.keys(hostForm.agentArgs).length > 0 ? { ...hostForm.agentArgs } : null,
  };

  // 별칭은 백엔드가 trim 해서 저장한다 — 메타 테이블 키도 같은 이름이어야 짝이 맞는다.
  const alias = hostForm.name.trim();
  const renamed = mode === "edit" && alias.toLowerCase() !== editOriginal.trim().toLowerCase();
  // 이름 변경의 **옛 별칭**. 아래에서 `editOriginal` 을 새 이름으로 넘기므로(재시도가 옛
  // 블록을 찾지 않도록) 팬아웃이 쓸 글자는 여기서 미리 붙잡아 둔다.
  const renameFrom = editOriginal.trim();
  // **AI 위임**(세 번째 파일)은 달라졌을 때만 쓴다 — 손대지 않은 저장이 `delegation.toml` 을
  // 건드리면, 설정에 없는 별칭(고아)을 고치던 저장이 "config 에 없습니다" 로 통째로 막힌다.
  // 의존 규칙은 여기서 한 번 접고(`withDependencies`), Rust 가 다시 한 번 본다.
  const delegationGrants = withDependencies({ ...hostForm.delegation });
  const delegationChanged = !sameGrants(delegationGrants, originalDelegation);
  const prev = originalMeta;
  // 저장 **전**의 포워딩 프리셋 — 아래 [`syncPresetForwards`] 가 이것과 새 목록의 차이만
  // 살아 있는 세션에 반영한다. 여기서 붙잡아 두는 이유는 `originalMeta` 가 저장 도중
  // 바뀌기 때문이다 (추가 모드는 성공 직후 수정 모드로 넘어가며 빈 메타를 끼워 넣는다).
  const beforeForwards = prev?.forwards ?? [];
  const hadMeta =
    prev !== null &&
    (prev.color != null ||
      prev.icon != null ||
      prev.group != null ||
      prev.tags.length > 0 ||
      prev.scrollback != null ||
      prev.on_connect != null ||
      prev.log != null ||
      prev.shell_integration != null ||
      prev.tmux != null ||
      prev.forward_agent != null ||
      prev.agent != null ||
      Object.keys(prev.agent_args ?? {}).length > 0 ||
      prev.forwards.length > 0);

  saving = true;
  formError = null;
  formErrorField = null;
  // ssh config 와 sessions.toml 은 **파일이 둘**이라 한 번에 커밋되지 않는다.
  // config 가 이미 저장된 뒤 메타 저장이 실패하면 그 사실을 문구로 구분해 준다.
  let configSaved = false;
  try {
    if (mode === "edit") {
      // 경고는 실패가 아니다 — 저장은 됐고 "이렇게 처리했다" 는 알림이라 토스트로만 띄운다.
      const warnings = await editHost({ ...payload, original_name: editOriginal });
      if (warnings.length > 0) showNotice(warnings.join(" / "));
    } else {
      await addHost(payload);
    }
    configSaved = true;
    if (mode === "add") {
      // 호스트는 이미 config 에 들어갔다 — 메타 저장이 실패해 다시 저장을 눌러도 "이미 있는
      // 별칭입니다" 로 막히지 않도록 수정 모드로 넘긴다.
      editOriginal = alias;
      originalMeta = { tags: [], forwards: [] }; // 방금 만든 호스트라 파일에는 아직 아무것도 없다
      mode = "edit";
    } else if (renamed) {
      // config 는 이미 새 별칭으로 바뀌었다. 메타 저장이 실패해 폼에서 다시 저장하더라도
      // 옛 이름으로 블록을 찾지 않도록(그리고 옛 메타 정리를 잊지 않도록) 여기서 넘겨 둔다.
      if (hadMeta) staleMetaAlias = editOriginal.trim();
      editOriginal = alias;
    }

    await setHostMeta(alias, patch);
    // 별칭을 바꿨으면 메타는 새 별칭 테이블에 저장했으니 옛 테이블은 지운다
    // (원래 메타가 있던 경우만 — 없던 호스트에 빈 쓰기를 보내지 않는다).
    if (staleMetaAlias && staleMetaAlias.toLowerCase() !== alias.toLowerCase()) {
      await setHostMeta(staleMetaAlias, emptyHostMetaPatch());
    }
    staleMetaAlias = null;

    // 두 파일이 다 새 이름으로 섰다 — 이제 **그 별칭을 적어 둔 앱 쪽 자리들**을 따라가게
    // 한다 (즐겨찾기·호스트 스니펫·저장한 레이아웃·열려 있는 탭). 이름만 바꾸고 말면 그
    // 자리들은 가리키는 것을 잃은 채 말없이 비어 버린다
    // (docs/log/2026-09-17-host-rename-fanout.md). 실패는 그 안에서 모아 한 줄로 알리고
    // **저장을 되돌리지 않는다** — 이름 변경 자체는 이미 성공했다.
    // **기다린다** — 이 팬아웃의 다섯째 걸음이 `delegation.toml` 의 별칭을 옮기고, 바로 아래
    // 위임 저장이 **새 이름**으로 쓴다. 순서가 뒤집히면 옛 블록이 남은 채 새 블록이 하나 더 생긴다.
    if (renamed) await hostAliasRenamed(renameFrom, alias);

    // **AI 위임** — `~/.ssh/config`·`sessions.toml` 에 이은 **세 번째 파일**이라 여기서도
    // 한 번에 커밋되지 않는다. 실패해도 **호스트 저장을 되돌리지 않는다**(앞의 둘은 이미
    // 섰다): 폼을 열어 둔 채 그 사실만 한 줄로 말하고, 다시 [저장]을 누르면 이 걸음만
    // 다시 돈다(앞의 둘은 같은 값이라 무해하다).
    let delegationFailure: string | null = null;
    if (delegationChanged) {
      try {
        await setDelegationTarget(alias, delegationGrants);
        originalDelegation = delegationGrants; // 재시도가 "안 바뀌었다" 로 건너뛰게
        refreshDelegationTargets();
      } catch (e) {
        delegationFailure = e instanceof Error ? e.message : String(e);
      }
    }

    // 그리고 **이 창에 붙어 있는 그 호스트의 타일들**을 저장한 목록에 맞춘다 — 지운 줄의
    // 터널은 내리고, 새로 적은 줄은 연다. 이름 변경 팬아웃 **뒤**여야 하는 이유: 타일의
    // `alias` 를 방금 새 이름으로 고친 것이 그 팬아웃이고, 여기서 타일을 고르는 열쇠가 그
    // 글자다 (docs/log/2026-09-17-forward-presets.md 의 "저장 시 열린 세션에 반영").
    // 기다리지도, 실패를 위로 던지지도 않는다 — 저장은 이미 끝났고 폼은 지금 닫힌다.
    void syncPresetForwards(alias, beforeForwards, parsedForwards.presets).catch((e) => {
      console.warn("[aynx] 포워딩 프리셋을 열린 세션에 반영하지 못했습니다:", e);
    });

    // 위임만 실패했으면 **폼을 닫지 않는다** — 호스트는 저장됐고 남은 것은 이 한 걸음뿐이라,
    // 닫아 버리면 사용자가 스위치를 다시 찾아 들어와야 한다. 칸을 집을 수 없는 실패다.
    if (delegationFailure !== null) {
      formError = t("files.host.save.delegationfail", { message: delegationFailure });
      formErrorField = null;
      refreshHosts();
      return;
    }

    mode = null;
    returnFocus(FOCUS_HOST_FORM); // 저장으로 닫히는 길도 취소·Escape 와 같은 자리로 돌아간다
    refreshHosts();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    formError = configSaved
      ? t("files.host.save.metafail", { message })
      : message;
    // config 쓰기가 실패한 것은 대개 별칭·호스트 이름 쪽이다 — 접속 탭의 첫 칸으로 데려간다.
    // 메타(`sessions.toml`) 쪽 실패는 칸 하나를 집을 수 없으므로 보던 탭을 그대로 둔다.
    formErrorField = configSaved ? null : "f-name";
    // config 는 이미 바뀌었으므로 목록은 그 상태로 맞춰 둔다 (폼은 열어 둔 채 재시도할 수 있게).
    if (configSaved) refreshHosts();
  } finally {
    saving = false;
  }
}

/**
 * **별칭 하나로** 수정 폼을 연다 — 부르는 쪽이 `HostEntry` 를 들고 있지 않은 자리(설정 › 보안의 AI 권한
 * 표 · 원격 타일의 권한 팝오버 "호스트 설정 › AI").
 *
 * `openEdit` 은 병합된 `HostEntry` 를 받으므로 목록을 그 자리에서 읽어 찾는다(캐시는 창마다 다를 수
 * 있다 — 떼어 낸 창은 독을 한 번도 안 열었을 수 있다). 못 찾으면 조용히 아무 일도 하지 않는다.
 */
export async function openEditByAlias(alias: string, tab: HostFormTab | null = null): Promise<void> {
  const { hosts } = await loadHosts(t);
  const key = alias.trim().toLowerCase();
  const host = hosts.find((h) => h.name.toLowerCase() === key);
  if (host) await openEdit(host, tab);
}

/**
 * "이름 변경" — 수정 모달을 열되 별칭 칸을 전체 선택해 곧장 고치게 한다.
 * 별칭 변경 자체는 `openEdit` → `submitForm` 의 기존 경로가 `Host` 블록 교체와 메타 이관까지
 * 올바로 처리하므로 여기서 손대지 않는다 (직접 rename 을 짜지 않는다).
 */
export function renameHost(host: HostEntry): void {
  selectNameOnce = true;
  void openEdit(host);
}
