// 호스트 폼의 수명 — 폼 세션 상태는 다시 대입되는 룬이라 대입하는 함수들과 한 파일이어야 한다(형제는 게터로만 읽는다).
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

const FOCUS_HOST_FORM = "host-form";

/** `null` 이면 폼이 닫혀 있다 */
let mode = $state<"add" | "edit" | null>(null);
/** 수정 대상의 원래 별칭 — 고칠 블록을 찾는 열쇠 */
let editOriginal = $state("");
let formError = $state<string | null>(null);
/** `formError` 를 건드리는 자리는 전부 이 값도 함께 건드린다 — 한쪽만 바꾸면 지난 오류의 칸으로 데려간다 */
let formErrorField = $state<string | null>(null);
let wantTab = $state<HostFormTab | null>(null);
let saving = $state(false);
let selectNameOnce = false;

/** 병합된 메타 — placeholder 힌트로만 쓴다. 폼을 채우면 상속값이 저장 순간 굳는다 */
let inherited = $state<HostMeta | null>(null);
/** `Host *` 등에서 물려받고만 있다 — 스위치는 꺼져 보이는데 접속은 켜진 채다 */
let inheritedIdentitiesOnlyFlag = $state(false);
let configForwardAgentFlag = $state(false);
/** `[hosts.<별칭>]` 에 실제로 적힌 것 */
let originalMeta = $state<HostMeta | null>(null);
/** 이것과 같으면 [저장]이 `delegation.toml` 을 건드리지 않는다 — 설정에 없는 별칭(고아)을 고치던 저장이 막히지 않게 */
let originalDelegation = $state<DelegationGrants>(noGrants());
/** 늦게 온 옛 메타 응답이 새 폼을 덮지 않게 하는 순번 */
let metaSeq = 0;
/** config 는 새 이름이 됐는데 옛 별칭의 메타 정리가 아직이다 — 두 파일은 한 번에 커밋되지 않는다 */
let staleMetaAlias: string | null = null;

export function hostFormMode(): "add" | "edit" | null {
  return mode;
}
export function hostFormOpen(): boolean {
  return mode !== null;
}
/** 호스트 키 · 비밀번호 모달이 떠 있으면 폼은 기다린다 */
export function hostFormVisible(): boolean {
  return mode !== null && !promptsBlocking();
}
export function editOriginalName(): string {
  return editOriginal;
}
export function hostFormError(): string | null {
  return formError;
}
export function hostFormErrorField(): string | null {
  return formErrorField;
}
/** 없으면 첫 탭 (docs/log/2026-09-21-fleet-delegation-ui.md) */
export function hostFormWantTab(): HostFormTab | null {
  return wantTab;
}
export function hostFormSaving(): boolean {
  return saving;
}
export function inheritedMeta(): HostMeta | null {
  return inherited;
}
export function inheritedIdentitiesOnly(): boolean {
  return inheritedIdentitiesOnlyFlag;
}
export function configForwardAgent(): boolean {
  return configForwardAgentFlag;
}
/** 이때 저장하면 비어 있는 메타 칸이 파일에 덮어써지므로 저장을 막는다 */
export function metaLoading(): boolean {
  return mode === "edit" && originalMeta === null;
}

export function focusHostForm(): void {
  formUi.firstField?.focus();
  if (selectNameOnce) {
    formUi.firstField?.select();
    selectNameOnce = false;
  }
}

/** `group` 은 트리가 보고 있는 폴더 — 그룹 칸만 미리 채운다 */
export function openAdd(group?: string): void {
  if (mode === null) rememberFocusOrigin(FOCUS_HOST_FORM);
  metaSeq += 1;
  resetForm();
  formUi.argsError = {};
  if (group) hostForm.group = group;
  editOriginal = "";
  inherited = null;
  inheritedIdentitiesOnlyFlag = false;
  configForwardAgentFlag = false;
  originalMeta = null;
  originalDelegation = noGrants();
  staleMetaAlias = null;
  formError = null;
  formErrorField = null;
  mode = "add";
  savedCreds.password = false;
  savedCreds.passphrase = null;
  ensureLogsFolder();
}

/**
 * config 칸은 병합값(`HostEntry`)으로 채우고 저장하면 이 블록에 직접 적힌다.
 * 메타는 반대로 원본(`get_host_meta`)으로 채운다 — 병합값으로 채우면 상속값이 `[hosts.<별칭>]` 에 굳는다.
 */
export async function openEdit(host: HostEntry, tab: HostFormTab | null = null): Promise<void> {
  if (mode === null) rememberFocusOrigin(FOCUS_HOST_FORM);
  resetForm();
  formUi.argsError = {};
  wantTab = tab;
  hostForm.name = host.name;
  hostForm.hostName = host.host_name ?? "";
  hostForm.user = host.user ?? "";
  hostForm.port = host.port ?? null;
  hostForm.identityFile = host.identity_file ?? "";
  // 자기 블록 값 — 병합값으로 채우면 `Host *` 에서 물려받은 값이 [저장] 한 번에 굳는다
  hostForm.identitiesOnly = host.identities_only_own === true;
  inheritedIdentitiesOnlyFlag = host.identities_only === true && host.identities_only_own !== true;
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
  savedCreds.password = false;
  savedCreds.passphrase = null;
  void refreshSavedCreds(host.name, hostForm.identityFile);

  const seq = ++metaSeq;
  // 순번은 메타와 같은 것 — 폼을 닫거나 다른 호스트를 열면 둘 다 함께 버려져야 한다
  void loadDelegationForForm(host.name, seq);

  const raw = await getHostMeta(host.name);
  if (seq !== metaSeq) return;
  originalMeta = raw;
  hostForm.color = raw.color ?? "";
  hostForm.icon = raw.icon ?? "";
  hostForm.group = raw.group ?? "";
  // 사본이다 — 같은 배열이면 저장 전 비교가 자기 자신과의 비교가 된다
  hostForm.tags = [...raw.tags];
  hostForm.scrollback = raw.scrollback ?? null;
  hostForm.onConnect = raw.on_connect ?? "";
  hostForm.log = raw.log ?? false;
  // 3값이라 `?? false` 로 접을 수 없다 — `null` 과 `false` 는 다른 상태다
  hostForm.shellIntegration =
    raw.shell_integration === true ? "on" : raw.shell_integration === false ? "off" : "";
  hostForm.tmux = raw.tmux ?? false;
  hostForm.agent = (raw.agent ?? inherited?.agent) === true;
  hostForm.agentArgs = { ...(raw.agent_args ?? {}) };
  hostForm.forwardAgent = forwardAgentOn(configForwardAgentFlag, raw.forward_agent);
  hostForm.forwards = raw.forwards.map(forwardRowOf);
  forwardRowError = null;
}

/** 읽기 실패는 빈 목록 — 손대지 않으면 `sameGrants` 비교가 `delegation.toml` 쓰기를 막는다 */
async function loadDelegationForForm(alias: string, seq: number): Promise<void> {
  const key = alias.trim().toLowerCase();
  const found = (await listDelegationTargets()).find((t) => t.alias.trim().toLowerCase() === key);
  if (seq !== metaSeq) return;
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
  metaSeq += 1;
  mode = null;
  wantTab = null;
  formError = null;
  formErrorField = null;
  forwardRowError = null;
  returnFocus(FOCUS_HOST_FORM);
}

// ---------------------------------------------------------------------------
// 포트 포워딩 프리셋 줄 (docs/log/2026-09-17-forward-presets.md)
// ---------------------------------------------------------------------------

/** 검증에 걸린 줄 번호 — `aria-invalid` 에만 쓴다 */
let forwardRowError = $state<number | null>(null);

export function forwardRowInvalid(index: number): boolean {
  return forwardRowError === index;
}

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

  // 먼저 비운다 — 같은 실수를 두 번 하면 `formErrorField` 가 그대로라 그 칸으로 데려가는 효과가 다시 돌지 않는다
  formError = null;
  formErrorField = null;

  const port = hostForm.port;
  const scrollback = hostForm.scrollback;
  const problem = validateHostForm(hostForm);
  if (problem !== null) {
    formError = hostFormProblemText(problem);
    formErrorField = problem.field;
    return;
  }

  // config 를 쓴 뒤 Rust 가 거절하면 "메타만 실패" 로 흐려진다 — 그 칸으로 먼저 데려간다
  for (const [id, error] of Object.entries(formUi.argsError)) {
    if (error && id in hostForm.agentArgs) {
      formError = error;
      formErrorField = `f-agent-args-${id}`;
      return;
    }
  }

  // 백엔드와 같은 규칙을 여기서 먼저 본다 — 왕복 뒤에 알리면 어느 줄이 문제인지 흐려진다
  const parsedForwards = parseForwardRows(hostForm.forwards, t);
  if (!parsedForwards.ok) {
    formError = parsedForwards.error;
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
    identities_only: identitiesOnlyFor(hostForm.identitiesOnly, hostForm.identityFile),
    proxy_jump: hostForm.proxyJump.trim() || null,
  };

  // sessions.toml 은 우리 소유라 완전한 상태를 그대로 보낸다 (빈 칸 = 키 삭제)
  const patch: HostMetaPatch = {
    color: hostForm.color.trim() || null,
    icon: hostForm.icon.trim() || null,
    group: hostForm.group.trim() || null,
    tags: hostForm.tags,
    scrollback,
    on_connect: hostForm.onConnect.trim() || null,
    log: hostForm.log,
    shell_integration:
      hostForm.shellIntegration === "on" ? true : hostForm.shellIntegration === "off" ? false : null,
    tmux: hostForm.tmux,
    forwards: parsedForwards.presets,
    forward_agent: forwardAgentPatch(hostForm.forwardAgent, configForwardAgentFlag),
    // 끔은 상속값이 켜져 있을 때만 `false`(위 계층을 덮는다), 아니면 키 삭제
    agent: hostForm.agent ? true : inherited?.agent === true ? false : null,
    agent_args: Object.keys(hostForm.agentArgs).length > 0 ? { ...hostForm.agentArgs } : null,
  };

  // 백엔드가 trim 해서 저장한다 — 메타 테이블 키도 같은 이름이어야 짝이 맞는다
  const alias = hostForm.name.trim();
  const renamed = mode === "edit" && alias.toLowerCase() !== editOriginal.trim().toLowerCase();
  // 아래에서 `editOriginal` 을 새 이름으로 넘기므로 미리 붙잡아 둔다
  const renameFrom = editOriginal.trim();
  // 달라졌을 때만 쓴다(`originalDelegation` 주석). 의존 규칙은 Rust 가 다시 한 번 본다
  const delegationGrants = withDependencies({ ...hostForm.delegation });
  const delegationChanged = !sameGrants(delegationGrants, originalDelegation);
  const prev = originalMeta;
  // 저장 도중 `originalMeta` 가 바뀌므로 미리 붙잡는다
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
  // ssh config 와 sessions.toml 은 파일이 둘이라 한 번에 커밋되지 않는다
  let configSaved = false;
  try {
    if (mode === "edit") {
      const warnings = await editHost({ ...payload, original_name: editOriginal });
      if (warnings.length > 0) showNotice(warnings.join(" / "));
    } else {
      await addHost(payload);
    }
    configSaved = true;
    if (mode === "add") {
      // 메타 저장이 실패해 다시 눌러도 "이미 있는 별칭" 으로 막히지 않게 수정 모드로 넘긴다
      editOriginal = alias;
      originalMeta = { tags: [], forwards: [] };
      mode = "edit";
    } else if (renamed) {
      // 재시도가 옛 이름으로 블록을 찾지 않게(옛 메타 정리는 잊지 않게) 여기서 넘긴다
      if (hadMeta) staleMetaAlias = editOriginal.trim();
      editOriginal = alias;
    }

    await setHostMeta(alias, patch);
    if (staleMetaAlias && staleMetaAlias.toLowerCase() !== alias.toLowerCase()) {
      await setHostMeta(staleMetaAlias, emptyHostMetaPatch());
    }
    staleMetaAlias = null;

    // 기다린다 — 팬아웃이 `delegation.toml` 의 별칭을 옮긴 뒤 아래 위임 저장이 새 이름으로 쓴다.
    // 뒤집히면 옛 블록이 남은 채 새 블록이 하나 더 생긴다 (docs/log/2026-09-17-host-rename-fanout.md)
    if (renamed) await hostAliasRenamed(renameFrom, alias);

    // 세 번째 파일 — 실패해도 호스트 저장은 되돌리지 않고, 다시 [저장]하면 이 걸음만 다시 돈다
    let delegationFailure: string | null = null;
    if (delegationChanged) {
      try {
        await setDelegationTarget(alias, delegationGrants);
        originalDelegation = delegationGrants;
        refreshDelegationTargets();
      } catch (e) {
        delegationFailure = e instanceof Error ? e.message : String(e);
      }
    }

    // 이름 변경 팬아웃 뒤여야 한다 — 타일을 고르는 열쇠가 팬아웃이 고친 `alias` 다
    void syncPresetForwards(alias, beforeForwards, parsedForwards.presets).catch((e) => {
      console.warn("[aynx] 포워딩 프리셋을 열린 세션에 반영하지 못했습니다:", e);
    });

    // 위임만 실패했으면 폼을 닫지 않는다
    if (delegationFailure !== null) {
      formError = t("files.host.save.delegationfail", { message: delegationFailure });
      formErrorField = null;
      refreshHosts();
      return;
    }

    mode = null;
    returnFocus(FOCUS_HOST_FORM);
    refreshHosts();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    formError = configSaved
      ? t("files.host.save.metafail", { message })
      : message;
    formErrorField = configSaved ? null : "f-name";
    if (configSaved) refreshHosts();
  } finally {
    saving = false;
  }
}

/** 캐시는 창마다 다를 수 있어 목록을 그 자리에서 읽는다. 못 찾으면 아무 일도 하지 않는다 */
export async function openEditByAlias(alias: string, tab: HostFormTab | null = null): Promise<void> {
  const { hosts } = await loadHosts(t);
  const key = alias.trim().toLowerCase();
  const host = hosts.find((h) => h.name.toLowerCase() === key);
  if (host) await openEdit(host, tab);
}

/** 별칭 변경은 `submitForm` 이 블록 교체 · 메타 이관까지 한다 — 따로 rename 을 짜지 않는다 */
export function renameHost(host: HostEntry): void {
  selectNameOnce = true;
  void openEdit(host);
}
