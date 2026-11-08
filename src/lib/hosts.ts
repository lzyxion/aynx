import { invoke } from "./ipc";
// **타입만** 빌린다 — 이 파일은 순수 모듈이라 룬(사전)을 값으로 들이지 않고 문구 함수를
// 인자로 받는다 (`i18n/ko/pane.ts` 머리말과 같은 분담).
import type { Tr } from "$lib/session";
import type { ForwardPreset } from "$lib/forward";

/**
 * `~/.ssh/sessions.toml` 에서 온 표시용 메타데이터 — Rust `HostMeta` 와 1:1 대응.
 *
 * 백엔드가 `hosts.<별칭> > presets.<preset> > [defaults]` 3계층을 **이미 병합해서** 내려준다.
 * 프런트는 병합하지 않고 이 값을 그대로 쓴다 (색 점은 `color` 그대로가 최종값).
 *
 * `scrollback` 은 SSH 탭을 열 때 xterm 생성 옵션으로 간다 (`+page.svelte` → `newSshTab`).
 * `on_connect` 은 **프런트를 거치지 않는다** — Rust 가 접속 시 sessions.toml 을 직접 읽어
 * 셸이 선 뒤 첫 입력으로 보낸다 (docs/log/2026-09-01-on-connect.md).
 * `identity` 는 계약에만 실려 있고 아직 배선되지 않았다.
 */
export interface HostMeta {
  /** CSS 색 문자열 그대로 (`#c25b4a`, `tomato`, …) */
  color?: string | null;
  /**
   * 호스트를 한눈에 구분하는 이모지 하나 (`🐧`, `🔥`, …). 사용자가 자유롭게 타이핑한다.
   * `color` 와 같은 규칙: 빈 문자열은 "지우기"(상속/없음)를 뜻한다. 사이드바에서 색 점보다
   * 우선해서 앞자리에 그려진다 (`Sidebar.svelte` 의 leading slot).
   */
  icon?: string | null;
  /** `"prod/web"` 같은 경로 문자열. 중첩 구조가 아니다 */
  group?: string | null;
  /** 항상 배열 (없으면 빈 배열) */
  tags: string[];
  scrollback?: number | null;
  on_connect?: string | null;
  identity?: string | null;
  /**
   * 세션 로깅 — 이 호스트에 접속하면 원격이 보낸 **원시 바이트**를 로컬 파일에 남긴다.
   * `on_connect` 처럼 **프런트를 거치지 않는다**: Rust 가 접속 시 sessions.toml 을 직접 읽어
   * 출력 펌프에서 tee 한다 (`src-tauri/src/session_log.rs`). 여기 값은 편집 폼 표시용이다.
   */
  log?: boolean | null;
  /**
   * 셸 통합(OSC 133) 주입 — **`false` 만 옵트아웃**이고 `null`/`true` 는 현행(주입)이다.
   * 끄면 접속할 때 SFTP 업로드도, `. ~/.aynx/integration.sh` 타이핑도, `~/.aynx` 생성도
   * 없다 (`src-tauri/src/ssh.rs`). 그 대가로 블록 기능(실패 표시·명령 점프·출력 복사·
   * 상태 배지·서버 이력)이 이 호스트에서 비활성화된다.
   */
  shell_integration?: boolean | null;
  /**
   * **tmux 로 접속** — 붙으면 셸 대신 이 호스트의 tmux 세션에 붙는다(없으면 만든다).
   * `null`/`false` 는 둘 다 꺼짐이다 (`log` 와 같은 규칙, `shell_integration` 과 반대).
   *
   * 켜면 그 타일은 **"화면만 있는 세션"**(간이 모드)이 된다 — OSC 133 마커가 tmux 를 넘지
   * 못하므로 셸 통합을 아예 심지 않고(`shell_integration` 값과 무관하게), 그래서 명령 이력·
   * 마지막 출력 복사·`#` 블록 검색·AI 의 명령 읽기가 꺼진다. 활동 표시와 화면 검색은 그대로다.
   * **이 호스트의 `on_connect` 도 실행되지 않는다**(v1 — 첫 입력 한 줄을 tmux 가 쓴다).
   * 판정과 조립은 전부 Rust 에 있다 (docs/log/2026-09-16-tmux-toggle.md).
   */
  tmux?: boolean | null;
  /**
   * **포트 포워딩 프리셋** — 이 호스트에 붙으면 자동으로 여는 `ssh -L` 목록.
   * `tags` 와 같이 **항상 배열**이다 (없으면 빈 배열).
   *
   * **상속하지 않는 유일한 칸**이라 `[defaults]`·프리셋에 적으면 무시되고 경고가 뜬다 —
   * 로컬 포트는 그 서버 한 대의 것이고, 무리 전체가 나눠 쓰면 둘째 접속부터 "포트가 이미
   * 사용 중" 이 된다 (docs/log/2026-09-17-forward-presets.md). 따라서 `hostMeta(entry)`
   * (병합값)와 `getHostMeta(name)`(원본)의 이 칸은 **언제나 같다.**
   */
  forwards: ForwardPreset[];
  /**
   * **에이전트 포워딩 덮어쓰기** — `~/.ssh/config` 의 `ForwardAgent` 를 이 호스트에서 이긴다.
   * `null`/없음 = 덮어쓰지 않음(config 를 따른다) · `true` 켬 · `false` 끔. `forwards` 처럼
   * **상속하지 않는다**(호스트 자기 블록에서만 온다) — docs/log/2026-09-23-agent-forwarding.md.
   */
  forward_agent?: boolean | null;
  /**
   * **에이전트 활성화** (2026-10-26 — 옛 `remote_hooks`) — 접속할 때 서버에 훅 · PATH 심(`~/.config/aynx/bin`) ·
   * 타일 파일의 추가 인자 키를 심어, 손으로 친 `claude` · `codex` 도 앱이 띄운 것과 같게 한다. `null`/`true` = 켬(기본) ·
   * **`false` 만 끔**(`shell_integration` 과 같은 쪽). 판정은 Rust(`ssh/open.rs` 의 `host_agent` · `auto_remote_agent`).
   */
  agent?: boolean | null;
  /**
   * **원격 추가 인자** — 에이전트 id → 한 줄. 키별로 상속하고(`[defaults]` → 프리셋 → 호스트) **빈 문자열 = 붙이지
   * 않음**으로 위를 덮는다. 원본(`getHostMeta`)은 자기 블록의 키만, 병합값(`hostMeta`)은 상속까지 합친 값이다.
   */
  agent_args?: Record<string, string>;
  /** `agent_args` 의 키별 출처 — 병합값에만 실린다(자기 값이면 그 키가 없다 · `color_from` 과 같은 규칙) */
  agent_args_from?: Record<string, MetaLayer>;
  /**
   * `color`·`icon` 이 **어느 위 계층에서 왔는가** — 병합값(`hostMeta`)에만 실린다(원본은 늘 없음).
   * 자기 블록 값이거나 값이 없으면 `null`. 호스트 폼의 상속 곁말이 읽는다(`host-meta-hint.ts`).
   */
  color_from?: MetaLayer | null;
  icon_from?: MetaLayer | null;
}

/** 상속값의 출처 계층 — Rust `MetaLayer` (`[defaults]` · `[presets.<이름>]`) */
export type MetaLayer = { kind: "defaults" } | { kind: "preset"; name: string };

/** `~/.ssh/config` 한 항목 — Rust `HostEntry` 와 1:1 대응 (snake_case 유지) */
export interface HostEntry {
  name: string;
  host_name?: string | null;
  user?: string | null;
  port?: number | null;
  identity_file?: string | null;
  /**
   * `IdentitiesOnly yes` — **병합값**이다 (`Host *` 같은 패턴 블록까지 합친 결과).
   * 접속이 실제로 보는 값이고, 목록 줄·오류 힌트가 이쪽을 읽는다.
   */
  identities_only?: boolean | null;
  /**
   * 같은 옵션의 **자기 블록 값**. 호스트 폼의 스위치가 읽는 것은 이쪽이다 — 병합값으로
   * 채우면 `Host *` 에서 물려받았을 뿐인 값이 [저장] 한 번에 이 블록으로 굳어 상속이
   * 끊긴다 (메타데이터에서 `getHostMeta`(원본)와 `hostMeta`(병합)를 가르는 것과 같은 규칙).
   */
  identities_only_own?: boolean | null;
  /**
   * `ForwardAgent yes` — **config 병합값**(`Host *` 까지). 접속이 실제로 보는 값은 이것과
   * 메타의 `forward_agent`(있으면 이긴다)를 합친 것이다 — [`forwardAgentOn`].
   */
  forward_agent?: boolean | null;
  proxy_jump?: string | null;
  server_alive_interval?: number | null;
  server_alive_count_max?: number | null;
  /** sessions.toml 메타데이터. **flatten 하지 않은 중첩 필드** — `host.meta.color` 로 읽는다 */
  meta?: HostMeta | null;
}

/** 메타데이터를 방어적으로 꺼낸다 — 백엔드가 옛 버전이라 `meta` 가 없어도 화면이 깨지지 않게 */
export function hostMeta(h: HostEntry): HostMeta {
  const m = h.meta;
  if (!m) return { tags: [], forwards: [] };
  return {
    ...m,
    tags: Array.isArray(m.tags) ? m.tags : [],
    forwards: Array.isArray(m.forwards) ? m.forwards : [],
  };
}

/** `list_hosts` 응답 — 파싱된 호스트 목록과 (치명적이지 않은) 경고 */
export interface SshConfig {
  hosts: HostEntry[];
  warnings: string[];
}

/** `add_host` 입력 — Rust `NewHost` 와 1:1 대응 (snake_case 유지) */
export interface NewHost {
  name: string;
  host_name: string;
  user?: string | null;
  port?: number | null;
  identity_file?: string | null;
  /**
   * `IdentitiesOnly` — 켜면 `    IdentitiesOnly yes` 한 줄이 블록에 적힌다.
   * `null`·`false` 는 **둘 다 그 줄을 지운다** (꺼짐이 OpenSSH 기본값이라 `no` 를 남길
   * 이유가 없고, `Host *` 에서 물려받던 값을 끊지 않는다). 값은 [`identitiesOnlyFor`] 가
   * 만든다 — 키 파일이 없으면 켤 수 없는 옵션이다.
   */
  identities_only?: boolean | null;
  /**
   * `ProxyJump` — 먼저 붙을 **경유 호스트** 한 대 (`null` = 직접 접속 = 그 줄을 지운다).
   * 한 단계만 지원한다: 쉼표 목록·자기 자신은 백엔드가 거절한다
   * (docs/log/2026-09-17-jump-host-ui.md).
   */
  proxy_jump?: string | null;
}

/**
 * `edit_host` 입력 — Rust `EditHost` 와 1:1 대응 (snake_case 유지).
 *
 * `original_name` 은 **고칠 블록을 찾는 열쇠**이고 `name` 은 저장할 새 별칭이다.
 * 둘이 다르면 별칭 변경(그 `Host` 줄의 패턴 토큰 하나만 교체)이 된다.
 */
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

/**
 * 호스트 목록을 읽는다.
 *
 * 백엔드 명령이 아직 등록되지 않았거나 설정 파싱이 실패해도 **throw 하지 않는다**.
 * 실패는 빈 목록 + 경고 한 줄로 내려와 사이드바가 그대로 렌더된다 — 그 줄은 호스트 목록
 * 머리의 "경고 N건" 에 그대로 뜨므로 **화면 문구**다 (`tr` 를 받는 이유).
 */
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

/**
 * 새 호스트를 `~/.ssh/config` **끝에 덧붙인다** (기존 내용은 재작성하지 않는다).
 *
 * `loadHosts` 와 달리 **실패를 삼키지 않는다** — 폼 안에 그대로 보여줘야 하는
 * 검증 오류("이미 있는 별칭입니다" 등)가 백엔드에서 오기 때문이다.
 */
export async function addHost(host: NewHost): Promise<void> {
  try {
    await invoke("add_host", { host });
  } catch (e) {
    throw new Error(describeError(e));
  }
}

/**
 * 기존 호스트의 `Host` 블록 **안쪽만** 고친다 (블록 밖은 한 바이트도 바뀌지 않는다).
 *
 * 반환값은 경고 목록 — 실패가 아니라 "이렇게 처리했다" 는 알림이다
 * (같은 별칭 블록이 여럿이라 첫 블록만 고쳤다 / 이 블록이 여러 패턴에 걸린다).
 * `addHost` 와 마찬가지로 **실패는 삼키지 않는다** — 폼에 그대로 띄운다.
 */
export async function editHost(host: EditHost): Promise<string[]> {
  try {
    const warnings = await invoke<string[]>("edit_host", { host });
    return Array.isArray(warnings) ? warnings : [];
  } catch (e) {
    throw new Error(describeError(e));
  }
}

/**
 * 호스트를 통째로 지운다 — `~/.ssh/config` 의 `Host <별칭>` 블록과
 * `~/.ssh/sessions.toml` 의 `[hosts.<별칭>]` 메타를 함께 제거한다.
 *
 * 반환값은 경고 목록 — `editHost` 와 같은 성격이라 실패가 아니라 "이렇게 처리했다" 는 알림이다
 * (같은 별칭 블록이 여럿이라 첫 블록만 지웠다 등). `editHost` 와 마찬가지로 **실패는 삼키지
 * 않는다** — 호출부(+page)가 잡아 notice 로 띄운다. 접속 설정을 실제로 건드리는 조작이라
 * 조용히 삼키면 지워졌는지 알 길이 없다.
 */
export async function removeHost(name: string): Promise<string[]> {
  try {
    const warnings = await invoke<string[]>("remove_host", { name });
    return Array.isArray(warnings) ? warnings : [];
  } catch (e) {
    throw new Error(describeError(e));
  }
}

/** [`forgetHostKey`] 의 결과 — Rust `ForgetHostKeyReport` 와 1:1 대응 */
export interface ForgetHostKeyReport {
  /** 실제로 지운 대상 (별칭이 아니라 `HostName`) */
  host: string;
  port: number;
  /** 지운 줄 수. 0 이면 파일을 건드리지 않았다 */
  removed: number;
}

/**
 * 이 별칭이 가리키는 서버의 `~/.ssh/known_hosts` 항목을 전부 지운다 (`ssh-keygen -R` 상당 ·
 * docs/log/2026-09-16-quick-connect-and-host-keys.md).
 *
 * 별칭 해석은 **접속과 같은 기계**를 지나므로 `HostName`·`Port` 가 그대로 반영된다. 해시된
 * 항목(`|1|salt|hash`)도 지워지고, 주석·다른 호스트의 줄·`@cert-authority` 줄은 남는다.
 *
 * `removeHost` 와 같은 규칙으로 **실패를 삼키지 않는다** — 신뢰 기록을 건드리는 조작이라
 * 조용히 넘어가면 지워졌는지 알 길이 없다.
 */
export async function forgetHostKey(alias: string): Promise<ForgetHostKeyReport> {
  try {
    return await invoke<ForgetHostKeyReport>("forget_host_key", { alias });
  } catch (e) {
    throw new Error(describeError(e));
  }
}

/**
 * `set_host_meta` 입력 — Rust `HostMetaPatch` 와 1:1 대응 (snake_case 유지).
 *
 * **`null` 은 "그대로 두기"가 아니라 "키를 지우기"다.** 폼이 아홉 칸을 모두 들고 있으므로
 * 매 저장이 이 아홉 키의 완전한 상태이고, 비운 칸은 곧 "상속/기본값으로 되돌리기"다.
 * 빈 문자열·빈 배열·`0` 도 지우기로 취급된다. 폼에 없는 `preset`·`identity` 는 건드리지 않는다.
 */
export interface HostMetaPatch {
  color: string | null;
  /** 이모지 아이콘. `color` 와 똑같이 빈 문자열 = 키 삭제(상속/없음) 규칙을 따른다 */
  icon: string | null;
  group: string | null;
  tags: string[];
  scrollback: number | null;
  on_connect: string | null;
  /**
   * 세션 로깅 체크박스. **`false` 는 `log = false` 가 아니라 키 삭제다** — 빈 칸과 같은
   * 규칙이라 `[defaults]`·preset 의 값을 되물려받는다. 개별 호스트에서만 상속을 끊으려면
   * 파일에 직접 `log = false` 를 적어야 한다.
   */
  log: boolean | null;
  /**
   * 셸 통합 3값 select. **여기서만 `false` 가 키 삭제가 아니라 `shell_integration = false`
   * 로 그대로 적힌다** — 상위 계층이 켜 놨어도 이 호스트만 끄는 것이 이 칸의 존재 이유다.
   * `null` = `기본 (켬 · 상속)` = 키 삭제, `true` = `켬`, `false` = `끔`.
   */
  shell_integration: boolean | null;
  /**
   * tmux 로 접속 체크박스. **`log` 와 같은 규칙** — `false`/`null` 은 둘 다 키 삭제다
   * (기본이 꺼짐이라 `tmux = false` 를 파일에 남길 이유가 없다).
   */
  tmux: boolean | null;
  /**
   * 포트 포워딩 프리셋 목록. **`tags` 와 같은 규칙** — 폼이 목록 전체를 들고 있으므로
   * 빈 배열은 키 삭제다. 상속이 없는 칸이라 "지우기" 가 곧 "이 호스트는 자동으로 아무것도
   * 열지 않는다" 로 끝난다 (`tags` 처럼 위 계층의 값이 되살아나지 않는다).
   *
   * 백엔드가 `port_forward::validate` 로 다시 검사하고, 겹치는 로컬 포트는 **저장 자체가
   * 거절된다** (파일에 한 글자도 닿지 않는다).
   */
  forwards: ForwardPreset[];
  /**
   * 에이전트 포워딩 덮어쓰기. **`shell_integration` 과 같은 규칙** — `false` 도 그대로
   * `forward_agent = false` 로 적힌다(config 의 `yes` 를 이 호스트에서 끄는 값). `null` = 키 삭제
   * = config 를 따른다. 값은 [`forwardAgentPatch`] 가 만든다.
   */
  forward_agent: boolean | null;
  /**
   * 에이전트 활성화 스위치. 기본이 켬이라 **`false` 만 `agent = false` 로 적히고**, `true`·`null` 은
   * 키 삭제다(Rust 가 접는다 — 옛 키 `remote_hooks` 도 그때 걷힌다).
   */
  agent: boolean | null;
  /**
   * 원격 추가 인자 — 호스트 **자기 블록에** 적을 에이전트별 한 줄(없는 키 = 상속 · `""` = 붙이지 않음).
   * `null`·빈 객체는 키 삭제다. Rust 가 `agent_args::parse_args` 로 다시 보고 어긋나면 저장하지 않는다.
   */
  agent_args: Record<string, string> | null;
}

/** 아홉 칸을 모두 비운 패치 — 호스트의 메타데이터 항목을 지운다 (별칭 변경 시 옛 항목 정리) */
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
 * **원본** 메타(`getHostMeta` 가 주는, `[hosts.<별칭>]` 에 실제로 적힌 값)를 `HostMetaPatch` 로
 * 그대로 옮긴다.
 *
 * 왜 필요한가 — `setHostMeta` 의 패치는 **완전 교체**다: 관리 키(color·icon·group·tags·
 * scrollback·on_connect·log·shell_integration·tmux·forwards) 중 패치에 없거나 `null`·빈 값인 키는 파일에서
 * **지워진다**. 그래서 한 칸(예: `group`)만 바꾸려 해도 나머지 여덟 칸을 다시 실어 보내지
 * 않으면 그 값들이 통째로 날아간다. 폼 저장 경로는 폼이 모든 칸을 들고 있어 문제가 없지만,
 * 드래그로 그룹만 재지정하는 경로(`onassigngroup`)는 폼을 거치지 않으므로 이 함수로 원본을
 * 먼저 패치로 펼친 뒤 `group` 한 칸만 덮어써야 다른 설정이 보존된다.
 *
 * **반드시 원본 메타(`getHostMeta`)를 넣을 것.** `hostMeta(entry)`/`HostEntry.meta` 는 `[defaults]`·
 * preset 까지 병합된 표시용 값이라, 그걸 넣어 저장하면 상속받던 값이 호스트 블록에 굳어 상속이
 * 끊긴다.
 *
 * 필드 이름·모양은 `HostMetaPatch` 를 그대로 따른다 (빈/없음은 `null`, `tags`·`forwards` 는 항상 배열).
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

/**
 * 편집 폼 프리필용 — `[hosts.<별칭>]` 에 **실제로 적힌** 값만 읽는다 (병합 결과가 아니다).
 *
 * `HostEntry.meta` 와 헷갈리지 말 것: 그쪽은 `[defaults]`·`preset` 까지 합친 **표시용** 값이다.
 * 병합값을 폼에 채워 저장하면 상속받던 값이 호스트 블록에 굳어 상속이 끊긴다 — 상속값은
 * placeholder 힌트로만 보여준다.
 *
 * `loadHosts` 처럼 **실패를 삼킨다** — 메타데이터를 못 읽어도 접속 설정 폼은 떠야 한다.
 */
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

/**
 * `~/.ssh/sessions.toml` 의 `[hosts.<별칭>]` **안쪽만** 고친다.
 * 다른 테이블·주석·키 순서·들여쓰기는 그대로다 (Rust 쪽에서 toml_edit 이 보장한다).
 *
 * `addHost`·`editHost` 와 마찬가지로 **실패는 삼키지 않는다** — 폼에 그대로 띄운다.
 */
export async function setHostMeta(name: string, patch: HostMetaPatch): Promise<void> {
  try {
    await invoke("set_host_meta", { name, patch });
  } catch (e) {
    throw new Error(describeError(e));
  }
}

/** `~/.ssh/config` 를 OS 기본 프로그램으로 연다 (없으면 빈 파일로 만들고 연다). */
export async function openSshConfig(): Promise<void> {
  try {
    await invoke("open_ssh_config");
  } catch (e) {
    throw new Error(describeError(e));
  }
}

/**
 * 세션 타일에서 시작하는 **모든** 드래그의 데이터 종류 — 호스트든 폴더든, 하나든 여럿이든
 * (docs/log/2026-09-04-hosts-multiselect.md).
 *
 * 예전에는 `application/x-aynx-host`(별칭 하나)와 `application/x-aynx-group`(경로 하나) 둘로
 * 갈려 있었다. 다중 선택이 생기면서 **한 드래그에 호스트와 폴더가 섞여 실릴 수 있게** 되자
 * 그 갈래가 성립하지 않는다 — 종류를 둘 다 실으면 받는 쪽마다 어느 쪽을 먼저 보느냐로
 * 뜻이 갈리고, 하나만 실으면 나머지 절반이 사라진다. 그래서 종류는 하나이고, 안에 든
 * 내용이 [`HostsDrag`] JSON 이다.
 *
 * `dragover` 단계에서는 브라우저 보안 규칙상 **값을 못 읽고 종류만** 볼 수 있다. 이 문자열이
 * 곧 "받아도 되는 드래그인가" 의 유일한 단서이고, 무엇이 들었는지(호스트냐 폴더냐 몇 개냐)는
 * 드롭 순간에야 알 수 있다. 드래그 중에도 그 답이 필요한 곳(폴더 중첩이 순환인지 미리
 * 판정해 강조를 켜는 자리)은 **드래그를 시작한 쪽이 자기 손에 쥔 값**을 본다.
 */
export const HOSTS_DRAG_TYPE = "application/x-aynx-hosts";

/**
 * 드래그에 실리는 짐 — 별칭 목록과 폴더 경로 목록.
 *
 * 값을 두 칸으로 나눠 두는 이유는 **뜻이 다르기 때문**이다: 폴더는 "그 아래 전부" 를 가리키는
 * 접두사라, 여는 쪽은 `hostsInGroup` 으로 펼쳐야 하고 옮기는 쪽은 경로 접두사를 다시 써야
 * 한다. 여기서 미리 펼쳐 별칭만 싣게 하면 폴더를 폴더로 옮기는 조작이 표현되지 않는다.
 *
 * 메타(색·스크롤백 등)는 싣지 않는다 — 받는 쪽이 이미 읽어 둔 같은 목록에서 별칭으로 다시
 * 찾으므로, 두 곳이 서로 다른 시점의 값을 들고 어긋날 일이 없다.
 */
export interface HostsDrag {
  /** 호스트 별칭들 */
  hosts: string[];
  /** 그룹(폴더) 전체 경로들 (`"prod/web"`) */
  groups: string[];
}

/** 빈 짐 — 파싱 실패의 안전한 결과이기도 하다 */
export const emptyHostsDrag = (): HostsDrag => ({ hosts: [], groups: [] });

/** 짐이 비었는가 (드롭을 받을지 정하는 데 쓴다) */
export function hostsDragEmpty(p: HostsDrag): boolean {
  return p.hosts.length === 0 && p.groups.length === 0;
}

/** `dataTransfer` 에 실을 문자열로 */
export function encodeHostsDrag(payload: HostsDrag): string {
  return JSON.stringify({ hosts: payload.hosts, groups: payload.groups });
}

/**
 * 실려 온 문자열을 짐으로 — **모양이 어긋난 값은 조용히 버린다**.
 *
 * 드래그 데이터는 다른 창(창 분리)에서 올 수도 있고 사용자가 옛 버전을 띄워 둔 채 업데이트할
 * 수도 있다. 여기서 던지면 드롭 핸들러 한가운데서 예외가 튀어 드래그가 반쯤 처리된 채 멈춘다.
 * 못 알아들은 것은 빈 짐이고, 빈 짐은 어느 드롭 대상에서도 아무 일도 하지 않는다.
 */
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
 * 짐을 **열 별칭 목록**으로 편다 — **순수 함수**.
 *
 * 폴더는 `hostsInGroup` 으로 그 아래(하위 폴더 포함) 전부를 펼치고, 호스트와 합쳐 **중복을
 * 지운다**: `prod` 폴더와 그 안의 `web-01` 을 함께 골라 끌면 `web-01` 이 두 번 열려서는 안 된다.
 *
 * 순서는 **`hosts` 배열 그대로**(= `~/.ssh/config` 등장 순서)다. 그 순서가 곧 타일이 놓이는
 * 순서이자 접속이 시작되는 순서이므로, 파일을 고쳐 순서를 정할 수 있어야 한다
 * (`hostsInGroup` 이 지키는 규칙과 같다).
 *
 * 목록에 **없는 별칭은 버리지 않고 맨 뒤에 붙인다** — 사이드바가 아직 못 읽은 호스트나
 * 다른 창에서 온 드래그일 수 있고, 여는 쪽은 목록에 없는 별칭도 그대로 시도한다.
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
    out.push(name); // 목록에 없는 별칭 — 여는 쪽이 그대로 시도한다
  }
  return out;
}

/**
 * 그룹 표시용 메타데이터 — Rust `GroupMeta` 와 1:1 대응. 아이콘과 색 두 칸이다(색은 2026-09-29 —
 * docs/log/2026-09-29-folder-project-icons.md). **폴더 자신의 얼굴에만** 쓰고 호스트에는 내려가지 않는다.
 * 키는 그룹의 **전체 경로**(`"prod/web"`)이고, `HostMeta.icon` 과 같은 규칙(빈 값 = 없음)을 따른다.
 *
 * **키의 존재 자체가 "이 폴더가 있다" 는 뜻이기도 하다.** 그룹은 원래 호스트들의 `group`
 * 경로에서 유도될 뿐이라 호스트가 하나도 없는 폴더는 존재할 수 없었는데, 탐색기에서
 * "폴더 추가" 로 만든 **빈 폴더**를 담을 곳이 달리 없다. 그래서 폴더 추가는 기본 아이콘
 * (`📁`)을 가진 항목 하나를 여기 적고, 목록을 그리는 쪽(`Sidebar.folderRows`)이 호스트들의
 * 그룹 경로와 **이 기록의 키들을 합집합**으로 훑는다 (docs/log/2026-09-03-hosts-icon-view-and-add.md).
 */
export interface GroupMeta {
  /** 폴더 줄 앞에 그리는 아이콘 — 이모지 또는 `svg:…` (`🚀`, `svg:lucide:folder-git-2`, …). 없으면 기본 폴더 */
  icon?: string | null;
  /** 폴더 아이콘의 색 — 단색(선) 아이콘과 기본 폴더가 입는다. 컬러 로고·이모지는 제 색 그대로 */
  color?: string | null;
}

/**
 * 모든 그룹의 메타데이터를 **전체 경로 → GroupMeta** 로 읽는다.
 *
 * `loadHosts` 처럼 **실패를 삼킨다** — 백엔드 명령이 아직 없거나 파싱이 실패해도 사이드바는
 * 그려져야 하므로, 못 읽으면 빈 기록으로 내려와 아이콘만 안 보일 뿐이다.
 */
export async function listGroupMeta(): Promise<Record<string, GroupMeta>> {
  try {
    const m = await invoke<Record<string, GroupMeta>>("list_group_meta");
    return m && typeof m === "object" ? m : {};
  } catch {
    return {};
  }
}

/**
 * 그룹 하나의 아이콘·색을 저장한다 (전체 경로 키). 빈/공백 문자열은 백엔드가 "지우기"로 취급한다.
 * 두 칸은 **늘 함께** 쓴다 — `color` 를 안 주면 그 폴더의 색은 지워진다.
 *
 * **빈 폴더를 만드는 유일한 수단이기도 하다** — 아이콘이 비어 있지 않으면 백엔드가
 * `[groups."경로"]` 를 만들어 유지하고, 비면 그 키를 지우고 빈 테이블까지 정리한다.
 * 그래서 "폴더 추가" 는 곧 `setGroupMeta(path, "📁")` 이고, 반대로 호스트가 없는 폴더에서
 * 아이콘을 지우면 **폴더 자체가 사라진다** (`GroupMeta` 주석 참고).
 *
 * `setHostMeta` 와 마찬가지로 **실패는 삼키지 않는다** — 호출부(사이드바 컨텍스트 메뉴)가
 * 잡아 안내를 띄운다.
 */
export async function setGroupMeta(path: string, icon: string | null, color: string | null = null): Promise<void> {
  try {
    await invoke("set_group_meta", { path, icon, color });
  } catch (e) {
    throw new Error(describeError(e));
  }
}

/**
 * 그룹 경로 접두사 `from` → `to` 를 모든 호스트·그룹 메타에 걸쳐 **한 번에** 다시 쓴다.
 * 이 단일 연산 하나가 이름 변경 · 재중첩 · 그룹 밖으로 빼기 · 해제를 모두 표현한다:
 *
 * - 이름 변경 : `to` 가 부모는 같고 마지막 세그먼트만 다르다.
 * - 재중첩    : `to` 가 다른 그룹 아래 경로다 (`"a" → "b/a"`).
 * - 밖으로 빼기: `to` 가 최상위(세그먼트 하나)다.
 * - 해제      : `to === ""` — 하위 호스트를 그룹에서 통째로 뺀다.
 *
 * 백엔드가 순환(자기 자신 또는 자손으로의 이동)을 거부한다. 프런트도 같은 판정을 미리 해
 * 명백히 잘못된 호출은 아예 보내지 않는다. **실패는 삼키지 않는다** — 호출부가 안내한다.
 */
export async function renameGroup(from: string, to: string): Promise<void> {
  try {
    await invoke("rename_group", { from, to });
  } catch (e) {
    throw new Error(describeError(e));
  }
}

/**
 * 그룹 하나에 속한 호스트들 — **순수 함수**
 * (그룹 폴더 전체 열기 · docs/log/2026-09-03-group-open-tiled.md).
 *
 * **하위 그룹까지 포함한다.** 그룹 경로가 `groupPath` 와 정확히 같거나 `groupPath + "/"` 로
 * 시작하면 이 그룹의 것이다 — 폴더를 끌면 그 안의 하위 폴더 내용까지 딸려 오는 것이
 * 파일 탐색기의 상식이고, 사이드바 머리글에 찍히는 개수(`count`)도 이미 같은 규칙으로
 * 하위 그룹을 합쳐 세고 있다. 그래서 `"prod"` 를 끌면 `prod/web`·`prod/db` 도 함께 열린다.
 *
 * 접두사 비교라 `"prod"` 가 `"production/web"` 을 잡지 않는다 (구분자까지 붙여 비교한다).
 * `hostMeta(h).group` 은 앞뒤 공백을 떼고 본다 — 손으로 적은 `sessions.toml` 에서
 * `group = " prod"` 같은 값이 조용히 빠지지 않게.
 *
 * 순서는 **입력 그대로**(= `~/.ssh/config` 의 등장 순서)다. 그 순서가 곧 타일이 놓이는
 * 순서이자 접속이 시작되는 순서이므로, 파일을 고쳐 순서를 정할 수 있어야 한다.
 */
export function hostsInGroup(hosts: HostEntry[], groupPath: string): HostEntry[] {
  const want = groupPath.trim();
  if (want === "") return [];
  const prefix = want + "/";
  return hosts.filter((h) => {
    const g = (hostMeta(h).group ?? "").trim();
    return g === want || g.startsWith(prefix);
  });
}

/**
 * 지금 **쓰이고 있는 그룹 경로**들 — 조상 경로까지 각각 한 줄로 편 뒤 사전순으로 준다.
 *
 * 호스트 폼의 그룹 칸 `<datalist>` 가 읽는다. `"prod/web"` 하나만 있어도 `"prod"` 를 함께
 * 내놓는 이유는 **부모 폴더로 곧장 넣기** 쉽게 하려는 것이다 (자유 입력은 그대로라 아직
 * 없는 새 경로도 타이핑할 수 있다).
 *
 * 빈 세그먼트는 버린다 — 손으로 적은 `sessions.toml` 의 `group = "prod//web"` 이
 * 빈 후보 한 줄을 만들지 않게.
 */
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
 * 복제할 때 **비어 있는 별칭**을 고른다 — `<이름>-copy`, 이미 있으면 `-copy-2`, `-copy-3` ….
 *
 * `taken` 은 **대소문자를 무시하고** 비교한다: 백엔드 `add_host` 가 그 규칙으로 중복을
 * 거절하므로 여기서 다른 규칙을 쓰면 "비었다고 골랐는데 거절당하는" 이름이 나온다.
 * 여러 개를 잇달아 복제하는 자리에서는 아직 파일에 없는 **이번 묶음의 이름들**도 함께
 * 넘겨야 한다 (호스트 목록은 파일을 다시 읽기 전까지 갱신되지 않는다).
 */
export function nextCopyAlias(base: string, taken: Iterable<string>): string {
  const used = new Set<string>();
  for (const name of taken) used.add(name.toLowerCase());
  let alias = `${base}-copy`;
  for (let n = 2; used.has(alias.toLowerCase()); n++) alias = `${base}-copy-${n}`;
  return alias;
}

/** 경로 비교용 정규화 — 구분자와 대소문자만 무시한다 (길이는 그대로라 `slice` 가 안전하다) */
const samePathKey = (p: string) => p.replace(/\\/g, "/").toLowerCase();

/**
 * 홈 아래 경로를 `~` 로 줄인다 (IdentityFile 칸의 표기 규칙).
 *
 * 고른 경로는 **OS 표기 그대로** 둔다 — Windows 면 백슬래시를 유지한다. 사용자의
 * `~/.ssh/config` 가 이미 `~\Documents\...` 형태로 적혀 있고 Windows OpenSSH 는 그 표기를
 * 그대로 읽으므로, 억지로 `/` 로 바꾸면 우리가 쓴 줄만 파일 안에서 튀어 보인다. 그래서
 * 비교만 정규화하고 잘라 낸 뒤쪽은 **원본 그대로** 이어 붙인다.
 *
 * 홈 밖이면 손대지 않는다. 홈 자신(`home` 과 같은 경로)도 그대로 둔다 — 개인키 자리가 아니다.
 */
export function shortenHomePath(picked: string, home: string): string {
  const base = home.replace(/[\\/]+$/, "");
  if (base === "") return picked;
  return samePathKey(picked).startsWith(`${samePathKey(base)}/`)
    ? `~${picked.slice(base.length)}`
    : picked;
}

/**
 * 볼트에 적힌 **개인키 경로**와 `IdentityFile` 칸의 값이 같은 키를 가리키는가 — **순수 함수**
 * (docs/log/2026-09-19-vault.md ③).
 *
 * 둘이 같은 글자일 수 없는 것이 이 함수의 이유다. 볼트에 담기는 것은 백엔드가 `~` 를 펴고
 * 파일로 확인한 **전체 경로**이고(`ssh.rs` 의 `identity_candidates`), 칸에 적힌 것은 사람이
 * `~/.ssh/config` 에 쓴 글자 그대로다. 그래서 프런트에서 경로를 **다시 만들어 맞추지 않고**
 * (홈 경로·구분자·`PathBuf::join` 의 표기까지 흉내 내야 한다 — 한 글자만 어긋나도 "담아
 * 뒀는데 없다고 말하는" 조용한 실패다) 담긴 목록을 훑어 **꼬리로** 맞춘다.
 *
 * 구분자와 대소문자는 무시한다 (`samePathKey` 와 같은 규칙 — Windows 에서
 * `~/.ssh/ID_ed25519` 와 `id_ed25519` 는 같은 파일이다). `~user/` 는 풀지 않는다 (OpenSSH 와
 * 달리 윈도우에 상대가 없어 백엔드도 안 푼다).
 */
export function sameIdentityPath(stored: string, configured: string): boolean {
  const norm = (p: string) => samePathKey(p.trim().replace(/^"|"$/g, "")).replace(/\/+$/, "");
  const s = norm(stored);
  const c = norm(configured);
  if (s === "" || c === "") return false;
  if (s === c) return true;
  // `~/.ssh/id_ed25519` — 홈을 모르므로 `~` 를 떼고 **꼬리 한 조각 이상**으로 맞춘다.
  return c.startsWith("~/") && s.endsWith(c.slice(1));
}

/**
 * 폼의 "이 키만 사용" 스위치가 실제로 파일에 적힐 값 — **순수 함수**
 * (docs/log/2026-09-19-identity-file-auth.md §11).
 *
 * 규칙 하나: **`IdentityFile` 이 비어 있으면 켤 수 없다.** 그 상태의 `IdentitiesOnly yes` 는
 * 사람이 기대하는 일("위 키 하나만 시도")을 하지 않는다 — OpenSSH 는 지정한 키가 없으면
 * `~/.ssh/id_*` 기본 이름을 그대로 쓰고, 이 옵션이 빼는 것은 **에이전트 키**뿐이다
 * (`src-tauri/src/ssh_config.rs` 의 `HostEntry::identities_only` 주석). 화면은 그때 스위치를
 * 재우지만, 칸을 비운 **뒤에** 저장하는 길도 있으므로 값을 만드는 자리에서 한 번 더 접는다.
 */
export function identitiesOnlyFor(on: boolean, identityFile: string): boolean {
  return on && identityFile.trim() !== "";
}

/**
 * 이 호스트에 접속하면 에이전트 포워딩이 켜지는가 — **순수 함수**. Rust 의
 * `agent_forward::effective` 와 같은 규칙이다: 메타의 덮어쓰기가 있으면 그것, 없으면 config 의
 * `ForwardAgent`. 폼의 스위치는 이 값으로 선다 (docs/log/2026-09-23-agent-forwarding.md).
 */
export function forwardAgentOn(
  config: boolean | null | undefined,
  override: boolean | null | undefined,
): boolean {
  return override ?? config === true;
}

/**
 * 폼의 "에이전트 포워딩" 스위치가 `sessions.toml` 에 적힐 값 — **순수 함수**.
 *
 * 스위치가 config 의 줄과 **같은 값**이면 덮어쓰기를 적지 않는다(`null` = 키 삭제) — 그래야
 * 손대지 않은 저장이 파일에 `forward_agent = false` 를 굳혀, 나중에 config 에 `ForwardAgent yes`
 * 를 적은 사람을 몰래 이기지 않는다. 다를 때만 `true`/`false` 가 적힌다.
 */
export function forwardAgentPatch(on: boolean, config: boolean | null | undefined): boolean | null {
  return on === (config === true) ? null : on;
}

/**
 * 부분수열(subsequence) 퍼지 매칭. 대소문자 무시, 질의의 공백은 무시한다.
 * 빈 질의는 항상 참.
 */
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

/** `user@host_name:port` — 있는 값만 이어 붙인다. 아무것도 없으면 빈 문자열 */
export function hostLabel(h: HostEntry): string {
  const user = h.user ? `${h.user}@` : "";
  const name = h.host_name ?? "";
  const port = h.port ? `:${h.port}` : "";
  if (!name) return user || port ? `${user}${port}` : "";
  return `${user}${name}${port}`;
}

/**
 * 검색 대상 문자열 — 별칭·접속 정보에 더해 **그룹 경로와 태그**까지 훑는다.
 * `"prod"` 로 검색하면 그룹이 `prod/web` 인 호스트도, 태그가 `prod` 인 호스트도 걸린다.
 */
export function hostSearchText(h: HostEntry): string {
  const m = hostMeta(h);
  const group = m.group ?? "";
  const tags = m.tags.join(" ");
  return `${h.name} ${hostLabel(h)} ${group} ${tags}`;
}
