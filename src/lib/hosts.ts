import { invoke } from "./ipc";
import type { Tr } from "$lib/session";
import type { ForwardPreset } from "$lib/forward";

/**
 * Rust `HostMeta` 와 1:1 — 백엔드가 `hosts.<별칭> > presets.<preset> > [defaults]` 를 이미 병합해 내려주고 프런트는 병합하지 않는다.
 * 병합값을 폼에 채워 저장하면 상속이 끊긴다 — 폼은 원본(`getHostMeta`)을 쓴다.
 */
export interface HostMeta {
  color?: string | null;
  /** 빈 문자열은 "지우기"(상속/없음) */
  icon?: string | null;
  group?: string | null;
  tags: string[];
  scrollback?: number | null;
  on_connect?: string | null;
  identity?: string | null;
  log?: boolean | null;
  /** `false` 만 옵트아웃이고 `null`/`true` 는 주입이다 */
  shell_integration?: boolean | null;
  /** `null`/`false` 는 둘 다 꺼짐. 켜면 셸 통합을 심지 않고 `on_connect` 도 실행되지 않는다 — 판정은 Rust 에 있다 */
  tmux?: boolean | null;
  /**
   * 상속하지 않는다 — `[defaults]` · 프리셋에 적으면 무시되고 경고가 뜬다(로컬 포트를 무리가 나눠 쓰면 둘째 접속부터 충돌).
   * 그래서 병합값과 원본의 이 칸은 언제나 같다.
   */
  forwards: ForwardPreset[];
  /**
   * `~/.ssh/config` 의 `ForwardAgent` 를 이 호스트에서 이긴다 — `null` = config 를 따른다 · `true` 켬 · `false` 끔.
   * 상속하지 않는다(호스트 자기 블록에서만 온다) (docs/log/2026-09-23-agent-forwarding.md).
   */
  forward_agent?: boolean | null;
  /** `null`/`true` = 켬(기본) · `false` 만 끔. 판정은 Rust `ssh/open.rs` */
  agent?: boolean | null;
  /** 에이전트 id → 한 줄. 키별로 상속하고 빈 문자열 = 붙이지 않음으로 위를 덮는다 */
  agent_args?: Record<string, string>;
  /** 병합값에만 실린다 — 자기 값이면 그 키가 없다 */
  agent_args_from?: Record<string, MetaLayer>;
  /** 병합값에만 실린다 — 자기 블록 값이거나 값이 없으면 `null` */
  color_from?: MetaLayer | null;
  icon_from?: MetaLayer | null;
}

/** Rust `MetaLayer` */
export type MetaLayer = { kind: "defaults" } | { kind: "preset"; name: string };

/** Rust `HostEntry` 와 1:1 (snake_case 유지) */
export interface HostEntry {
  name: string;
  host_name?: string | null;
  user?: string | null;
  port?: number | null;
  identity_file?: string | null;
  /** 병합값(`Host *` 까지) — 접속이 실제로 보는 값 */
  identities_only?: boolean | null;
  /** 자기 블록 값 — 폼 스위치는 이쪽을 읽는다. 병합값으로 채우면 [저장] 한 번에 상속이 끊긴다 */
  identities_only_own?: boolean | null;
  /** config 병합값 — 실제 값은 메타의 `forward_agent` 와 합친 [`forwardAgentOn`] */
  forward_agent?: boolean | null;
  proxy_jump?: string | null;
  server_alive_interval?: number | null;
  server_alive_count_max?: number | null;
  /** flatten 하지 않은 중첩 필드 */
  meta?: HostMeta | null;
}

/** 옛 백엔드라 `meta` 가 없어도 화면이 깨지지 않게 */
export function hostMeta(h: HostEntry): HostMeta {
  const m = h.meta;
  if (!m) return { tags: [], forwards: [] };
  return {
    ...m,
    tags: Array.isArray(m.tags) ? m.tags : [],
    forwards: Array.isArray(m.forwards) ? m.forwards : [],
  };
}

export interface SshConfig {
  hosts: HostEntry[];
  warnings: string[];
}

/** Rust `NewHost` 와 1:1 (snake_case 유지) */
export interface NewHost {
  name: string;
  host_name: string;
  user?: string | null;
  port?: number | null;
  identity_file?: string | null;
  /** `null` · `false` 는 둘 다 그 줄을 지운다 — `Host *` 에서 물려받던 값을 끊지 않는다 */
  identities_only?: boolean | null;
  /** 한 단계만 — 쉼표 목록 · 자기 자신은 백엔드가 거절한다 */
  proxy_jump?: string | null;
}

/** Rust `EditHost` 와 1:1. `original_name` 은 고칠 블록을 찾는 열쇠, `name` 은 새 별칭이다 */
export interface EditHost extends NewHost {
  original_name: string;
}

function describeError(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

/** throw 하지 않는다 — 실패는 빈 목록 + 경고 한 줄(화면 문구)이다 */
export async function loadHosts(tr: Tr): Promise<SshConfig> {
  try {
    const cfg = await invoke<SshConfig>("list_hosts");
    return {
      hosts: Array.isArray(cfg?.hosts) ? cfg.hosts : [],
      warnings: Array.isArray(cfg?.warnings) ? cfg.warnings : [],
    };
  } catch (e) {
    return { hosts: [], warnings: [tr("app.hosts.load.failed", { reason: describeError(e) })] };
  }
}

/** 실패를 삼키지 않는다 — 검증 오류("이미 있는 별칭입니다")를 폼에 띄운다 */
export async function addHost(host: NewHost): Promise<void> {
  try {
    await invoke("add_host", { host });
  } catch (e) {
    throw new Error(describeError(e));
  }
}

/** 반환값은 실패가 아니라 "이렇게 처리했다" 는 경고들이다. 실패는 삼키지 않는다 */
export async function editHost(host: EditHost): Promise<string[]> {
  try {
    const warnings = await invoke<string[]>("edit_host", { host });
    return Array.isArray(warnings) ? warnings : [];
  } catch (e) {
    throw new Error(describeError(e));
  }
}

/** `Host <별칭>` 블록과 `[hosts.<별칭>]` 메타를 함께 지운다. 실패는 삼키지 않는다 — 지워졌는지 알 길이 없어진다 */
export async function removeHost(name: string): Promise<string[]> {
  try {
    const warnings = await invoke<string[]>("remove_host", { name });
    return Array.isArray(warnings) ? warnings : [];
  } catch (e) {
    throw new Error(describeError(e));
  }
}

/** Rust `ForgetHostKeyReport` 와 1:1 */
export interface ForgetHostKeyReport {
  /** 별칭이 아니라 `HostName` */
  host: string;
  port: number;
  removed: number;
}

/** `ssh-keygen -R` 상당. 신뢰 기록을 건드리는 조작이라 실패를 삼키지 않는다 */
export async function forgetHostKey(alias: string): Promise<ForgetHostKeyReport> {
  try {
    return await invoke<ForgetHostKeyReport>("forget_host_key", { alias });
  } catch (e) {
    throw new Error(describeError(e));
  }
}

/**
 * Rust `HostMetaPatch` 와 1:1. 완전 교체다 — `null` · 빈 문자열 · 빈 배열 · `0` 은 "그대로 두기"가 아니라 키 지우기(상속으로 되돌리기)다.
 * 패치에 없는 `preset` · `identity` 는 건드리지 않는다.
 */
export interface HostMetaPatch {
  color: string | null;
  icon: string | null;
  group: string | null;
  tags: string[];
  scrollback: number | null;
  on_connect: string | null;
  /** `false` 도 키 삭제라 위 계층 값을 되물려받는다 — 상속을 끊으려면 파일에 직접 `log = false` 를 적는다 */
  log: boolean | null;
  /** `false` 는 키 삭제가 아니라 `shell_integration = false` 로 적힌다 — 위 계층이 켜 놨어도 이 호스트만 끈다 */
  shell_integration: boolean | null;
  /** `false` / `null` 은 둘 다 키 삭제 */
  tmux: boolean | null;
  /** 빈 배열은 키 삭제 — 상속이 없어 위 계층 값이 되살아나지 않는다. 겹치는 로컬 포트는 백엔드가 저장을 거절한다 */
  forwards: ForwardPreset[];
  /** `false` 도 그대로 적힌다(config 의 `yes` 를 이 호스트에서 끈다) · `null` = 키 삭제 = config 를 따른다 */
  forward_agent: boolean | null;
  /** `false` 만 `agent = false` 로 적히고 `true` · `null` 은 키 삭제다(옛 키 `remote_hooks` 도 그때 걷힌다) */
  agent: boolean | null;
  /** 호스트 자기 블록의 키만. `null` · 빈 객체는 키 삭제 */
  agent_args: Record<string, string> | null;
}

/** 메타 항목을 통째로 지우는 패치 — 별칭 변경 때 옛 항목 정리 */
export const emptyHostMetaPatch = (): HostMetaPatch => ({
  color: null,
  icon: null,
  group: null,
  tags: [],
  scrollback: null,
  on_connect: null,
  log: null,
  shell_integration: null,
  tmux: null,
  forwards: [],
  forward_agent: null,
  agent: null,
  agent_args: null,
});

/**
 * 한 칸만 바꾸는 저장(드래그로 그룹 재지정)이 나머지 칸을 지우지 않게 원본을 패치로 편다.
 * 반드시 원본(`getHostMeta`)을 넣는다 — 병합값(`hostMeta`)을 넣으면 상속받던 값이 호스트 블록에 굳는다.
 */
export function metaToPatch(m: HostMeta): HostMetaPatch {
  return {
    color: m.color ?? null,
    icon: m.icon ?? null,
    group: m.group ?? null,
    tags: Array.isArray(m.tags) ? m.tags : [],
    scrollback: m.scrollback ?? null,
    on_connect: m.on_connect ?? null,
    log: m.log ?? null,
    shell_integration: m.shell_integration ?? null,
    tmux: m.tmux ?? null,
    forwards: Array.isArray(m.forwards) ? m.forwards : [],
    forward_agent: m.forward_agent ?? null,
    agent: m.agent ?? null,
    agent_args: m.agent_args && Object.keys(m.agent_args).length > 0 ? { ...m.agent_args } : null,
  };
}

/** `[hosts.<별칭>]` 에 실제로 적힌 값만(병합 아님). 실패를 삼킨다 — 메타를 못 읽어도 접속 설정 폼은 떠야 한다 */
export async function getHostMeta(name: string): Promise<HostMeta> {
  try {
    const m = await invoke<HostMeta>("get_host_meta", { name });
    return {
      ...m,
      tags: Array.isArray(m?.tags) ? m.tags : [],
      forwards: Array.isArray(m?.forwards) ? m.forwards : [],
    };
  } catch {
    return { tags: [], forwards: [] };
  }
}

/** 실패는 삼키지 않는다 — 폼에 띄운다 */
export async function setHostMeta(name: string, patch: HostMetaPatch): Promise<void> {
  try {
    await invoke("set_host_meta", { name, patch });
  } catch (e) {
    throw new Error(describeError(e));
  }
}

export async function openSshConfig(): Promise<void> {
  try {
    await invoke("open_ssh_config");
  } catch (e) {
    throw new Error(describeError(e));
  }
}

/**
 * 세션 타일에서 시작하는 모든 드래그의 데이터 종류 하나 — 안에 [`HostsDrag`] JSON 이 든다.
 * `dragover` 에서는 값을 못 읽고 종류만 보이므로, 드래그 중 판정은 드래그를 시작한 쪽이 쥔 값을 본다.
 */
export const HOSTS_DRAG_TYPE = "application/x-aynx-hosts";

/** 폴더는 "그 아래 전부" 를 가리키는 접두사라 별칭으로 미리 펴지 않는다 — 펴면 폴더째 옮기기가 표현되지 않는다 */
export interface HostsDrag {
  hosts: string[];
  groups: string[];
}

export const emptyHostsDrag = (): HostsDrag => ({ hosts: [], groups: [] });

export function hostsDragEmpty(p: HostsDrag): boolean {
  return p.hosts.length === 0 && p.groups.length === 0;
}

export function encodeHostsDrag(payload: HostsDrag): string {
  return JSON.stringify({ hosts: payload.hosts, groups: payload.groups });
}

/** 던지지 않는다 — 다른 창 · 옛 버전에서 온 값일 수 있고, 드롭 핸들러 한가운데서 튀면 드래그가 반쯤 처리된 채 멈춘다 */
export function decodeHostsDrag(raw: string): HostsDrag {
  if (!raw) return emptyHostsDrag();
  try {
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== "object") return emptyHostsDrag();
    const o = data as Record<string, unknown>;
    const strings = (v: unknown): string[] =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "") : [];
    return { hosts: strings(o.hosts), groups: strings(o.groups) };
  } catch {
    return emptyHostsDrag();
  }
}

/**
 * 순서는 `~/.ssh/config` 등장 순서 — 타일이 놓이고 접속이 시작되는 순서라 파일로 정할 수 있어야 한다.
 * 목록에 없는 별칭은 버리지 않고 맨 뒤에 붙인다 — 아직 못 읽은 호스트 · 다른 창의 드래그일 수 있다.
 */
export function resolveHostsDrag(hosts: HostEntry[], payload: HostsDrag): string[] {
  const want = new Set(payload.hosts);
  for (const path of payload.groups) {
    for (const h of hostsInGroup(hosts, path)) want.add(h.name);
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const h of hosts) {
    if (!want.has(h.name) || seen.has(h.name)) continue;
    seen.add(h.name);
    out.push(h.name);
  }
  for (const name of payload.hosts) {
    if (seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

/**
 * Rust `GroupMeta` 와 1:1 — 키는 그룹 전체 경로이고, 폴더 자신의 얼굴에만 쓰며 호스트에는 내려가지 않는다.
 * 키의 존재가 곧 "이 폴더가 있다" 이다 — 빈 폴더는 여기에만 산다(`host-folders.ts` 의 `folderRows` 가 합집합으로 훑는다).
 */
export interface GroupMeta {
  icon?: string | null;
  /** 단색 아이콘과 기본 폴더만 입는다 — 컬러 로고 · 이모지는 제 색 그대로 */
  color?: string | null;
}

/** 실패를 삼킨다 — 못 읽으면 아이콘만 안 보인다 */
export async function listGroupMeta(): Promise<Record<string, GroupMeta>> {
  try {
    const m = await invoke<Record<string, GroupMeta>>("list_group_meta");
    return m && typeof m === "object" ? m : {};
  } catch {
    return {};
  }
}

/**
 * 두 칸은 늘 함께 쓴다 — `color` 를 안 주면 그 폴더의 색은 지워진다. 실패는 삼키지 않는다.
 * 빈 폴더를 만드는 유일한 수단이다 — 아이콘이 비면 키가 지워져, 호스트가 없는 폴더는 자체가 사라진다.
 */
export async function setGroupMeta(path: string, icon: string | null, color: string | null = null): Promise<void> {
  try {
    await invoke("set_group_meta", { path, icon, color });
  } catch (e) {
    throw new Error(describeError(e));
  }
}

/** 경로 접두사 다시 쓰기 하나가 이름 변경 · 재중첩 · 밖으로 빼기 · 해제(`to === ""`)를 모두 한다. 실패는 삼키지 않는다 */
export async function renameGroup(from: string, to: string): Promise<void> {
  try {
    await invoke("rename_group", { from, to });
  } catch (e) {
    throw new Error(describeError(e));
  }
}

/** 하위 그룹까지 포함하고, 순서는 입력(`~/.ssh/config` 등장 순서) 그대로다 — 타일 · 접속 순서가 된다 */
export function hostsInGroup(hosts: HostEntry[], groupPath: string): HostEntry[] {
  const want = groupPath.trim();
  if (want === "") return [];
  const prefix = want + "/";
  return hosts.filter((h) => {
    const g = (hostMeta(h).group ?? "").trim();
    return g === want || g.startsWith(prefix);
  });
}

/** 조상 경로까지 편다 */
export function groupPaths(hosts: readonly HostEntry[]): string[] {
  const set = new Set<string>();
  for (const h of hosts) {
    const raw = hostMeta(h).group?.trim();
    if (!raw) continue;
    let path = "";
    for (const seg of raw.split("/").map((s) => s.trim())) {
      if (seg === "") continue;
      path = path ? `${path}/${seg}` : seg;
      set.add(path);
    }
  }
  return [...set].sort();
}

/**
 * 대소문자를 무시한다 — 백엔드 `add_host` 의 중복 규칙과 같아야 고른 이름이 거절당하지 않는다.
 * 잇달아 복제할 때는 아직 파일에 없는 이번 묶음의 이름도 `taken` 에 넣는다.
 */
export function nextCopyAlias(base: string, taken: Iterable<string>): string {
  const used = new Set<string>();
  for (const name of taken) used.add(name.toLowerCase());
  let alias = `${base}-copy`;
  for (let n = 2; used.has(alias.toLowerCase()); n++) alias = `${base}-copy-${n}`;
  return alias;
}

/** 길이를 바꾸지 않는다 — 부르는 쪽의 `slice` 가 원본에 그대로 쓴다 */
const samePathKey = (p: string) => p.replace(/\\/g, "/").toLowerCase();

/** 비교만 정규화하고 잘라 낸 뒤쪽은 OS 표기 그대로 잇는다 — Windows OpenSSH 는 `~\…` 도 읽는다 */
export function shortenHomePath(picked: string, home: string): string {
  const base = home.replace(/[\\/]+$/, "");
  if (base === "") return picked;
  return samePathKey(picked).startsWith(`${samePathKey(base)}/`)
    ? `~${picked.slice(base.length)}`
    : picked;
}

/**
 * 볼트에 담긴 것은 백엔드가 `~` 를 편 전체 경로이고 칸은 사람이 쓴 글자다 — 프런트가 경로를 다시 만들지 않고 꼬리로 맞춘다
 * (홈 · 구분자 표기를 흉내 내다 한 글자 어긋나면 조용한 실패다). `~user/` 는 백엔드도 풀지 않는다 (docs/log/2026-09-19-vault.md).
 */
export function sameIdentityPath(stored: string, configured: string): boolean {
  const norm = (p: string) => samePathKey(p.trim().replace(/^"|"$/g, "")).replace(/\/+$/, "");
  const s = norm(stored);
  const c = norm(configured);
  if (s === "" || c === "") return false;
  if (s === c) return true;
  return c.startsWith("~/") && s.endsWith(c.slice(1));
}

/**
 * `IdentityFile` 이 비어 있으면 켤 수 없다 — 그때 `IdentitiesOnly yes` 는 에이전트 키만 빼고 `~/.ssh/id_*` 는 그대로 쓴다.
 * 칸을 비운 뒤 저장하는 길이 있어 화면이 스위치를 재워도 여기서 한 번 더 접는다.
 */
export function identitiesOnlyFor(on: boolean, identityFile: string): boolean {
  return on && identityFile.trim() !== "";
}

/** Rust `agent_forward::effective` 와 같은 규칙 — 메타의 덮어쓰기가 있으면 그것, 없으면 config 의 `ForwardAgent` */
export function forwardAgentOn(
  config: boolean | null | undefined,
  override: boolean | null | undefined,
): boolean {
  return override ?? config === true;
}

/** config 와 같은 값이면 `null`(덮어쓰기 안 적음) — 손대지 않은 저장이 `false` 를 굳혀 나중의 `ForwardAgent yes` 를 몰래 이기지 않게 */
export function forwardAgentPatch(on: boolean, config: boolean | null | undefined): boolean | null {
  return on === (config === true) ? null : on;
}

/** 부분수열 매칭 — 대소문자 · 질의의 공백 무시 */
export function fuzzyMatch(query: string, text: string): boolean {
  const q = query.toLowerCase().replace(/\s+/g, "");
  if (q === "") return true;
  const t = text.toLowerCase();
  let i = 0;
  for (let j = 0; j < t.length && i < q.length; j++) {
    if (t[j] === q[i]) i += 1;
  }
  return i === q.length;
}

export function hostLabel(h: HostEntry): string {
  const user = h.user ? `${h.user}@` : "";
  const name = h.host_name ?? "";
  const port = h.port ? `:${h.port}` : "";
  if (!name) return user || port ? `${user}${port}` : "";
  return `${user}${name}${port}`;
}

/** 그룹 경로를 품는다 — 폴더 이름 검색이 이 길로 된다 */
export function hostSearchText(h: HostEntry): string {
  const m = hostMeta(h);
  const group = m.group ?? "";
  const tags = m.tags.join(" ");
  return `${h.name} ${hostLabel(h)} ${group} ${tags}`;
}
