//! 접속 파라미터 해석 — 별칭/빠른 접속 대상([`AdhocTarget`]) → [`ConnectParams`].
//! ProxyJump 해석, `IdentityFile` 후보 경로, keepalive 기본값이 여기 있다. 네트워크는 만지지 않는다.

use std::path::{Path, PathBuf};
use std::time::Duration;

use crate::i18n::tr;
use crate::ssh_config::{HostEntry, StrictHostKeyChecking};

use super::*;

/// ServerAliveInterval 기본값 (OpenSSH 는 0=비활성이지만, 우리는 기본을 켜 둔다).
pub(super) const DEFAULT_KEEPALIVE_SECS: u64 = 30;
/// ServerAliveCountMax 기본값.
pub(super) const DEFAULT_KEEPALIVE_MAX: usize = 3;

// ---------------------------------------------------------------------------
// 빠른 접속 대상 (설정에 없는 호스트 — docs/log/2026-09-16-quick-connect-and-host-keys.md)
// ---------------------------------------------------------------------------

/// `~/.ssh/config` 에 항목이 없는 **그 자리 접속** 대상. 프런트가 한 줄(`user@host:port`)을
/// 파싱해 넘긴다 (`src/lib/quick-connect.ts` — 문법과 거절 규칙은 그쪽이 단일 진실이다).
///
/// 여기서 하는 일은 그것을 [`ConnectParams`] 로 펴는 것뿐이고, **config 는 보지 않는다**:
/// `Host *` 블록의 기본값도, `ProxyJump` 도, `IdentityFile` 도 실리지 않는다. 이유는
/// [`resolve_adhoc`] 의 설명 참고.
#[derive(Debug, Clone, serde::Deserialize)]
pub struct AdhocTarget {
    pub host: String,
    pub user: Option<String>,
    pub port: Option<u16>,
}

/// 빠른 접속 대상을 접속 파라미터로 편다 — **순수 함수**(유닛 테스트 대상).
///
/// ## config 를 보지 않는 이유
///
/// `ssh_config::parse` 는 **구체 별칭에만** `HostEntry` 를 만든다 (`Host *` 블록의 옵션은
/// 그 별칭들에 병합될 뿐, 이름 없는 대상에게 줄 항목이 없다). 그래서 `resolve_params` 에
/// 처음 보는 이름을 넘겨도 `Host *` 의 값은 실리지 않는다 — **설정에 없는 별칭은 예나 지금이나
/// 전부 기본값**이다. 빠른 접속을 그 규칙 밖으로 빼지 않는다: 사용자 이름은 OS 사용자,
/// 포트는 22, 호스트 키 검증은 **언제나 켜짐**(`StrictHostKeyChecking yes`)이다.
///
/// 완화가 붙는 길이 없다는 것이 요점이다 — `no`·`accept-new` 는 사용자가 자기 config 의 그
/// 호스트 블록에 직접 적었을 때만 생기는데, 빠른 접속에는 그 블록이 없다.
pub(super) fn resolve_adhoc(
    target: &AdhocTarget,
    fallback_user: Option<&str>,
) -> Result<ConnectParams, SshOpenError> {
    let host = target.host.trim();
    if host.is_empty() {
        return Err(SshOpenError::other(tr!(
            ko: "접속할 호스트가 비어 있습니다",
            en: "The host to connect to is empty"
        )));
    }
    let user = target
        .user
        .as_deref()
        .map(str::trim)
        .filter(|u| !u.is_empty())
        .map(str::to_string)
        .or_else(|| fallback_user.map(str::to_string))
        .filter(|u| !u.is_empty())
        .ok_or_else(|| {
            SshOpenError::other(tr!(
                ko: "접속할 사용자 이름을 알 수 없습니다 — user@host 로 적거나 USERNAME 환경 변수를 설정하세요",
                en: "Cannot tell which user name to connect with — write user@host or set the USERNAME environment variable"
            ))
        })?;

    Ok(ConnectParams {
        host: host.to_string(),
        port: target.port.unwrap_or(22),
        user,
        keepalive_interval: Some(Duration::from_secs(DEFAULT_KEEPALIVE_SECS)),
        keepalive_max: DEFAULT_KEEPALIVE_MAX,
        strict: StrictHostKeyChecking::default(),
        no_host_key_store: false,
        // 빠른 접속에는 config 블록이 없다 — `IdentityFile` 도 없다. 키 파일 인증은 그래서
        // **기본 이름들**(`~/.ssh/id_ed25519` …)만 타고, 그것이 `ssh user@host` 와 같은 동작이다.
        identity_file: None,
        // 후보를 좁힐 `IdentityFile` 도, 그것을 좁히라는 줄도 없다.
        identities_only: false,
        // 빠른 접속은 에이전트를 넘기지 않는다 — 켜는 자리(호스트 폼)가 없는 대상이다.
        forward_agent: false,
        jump: None,
    })
}

// ---------------------------------------------------------------------------
// 접속 파라미터 해석
// ---------------------------------------------------------------------------

/// 다중 홉(`ProxyJump a,b`) 거부 문구. 테스트가 문자열로 확인한다.
/// (상수였던 자리 — 언어를 따라가야 해서 함수가 됐다.)
///
/// **호스트 폼도 이 한 줄을 쓴다** ([`crate::config_edit`]) — 접속이 거절할 값을 저장부터
/// 막지 않으면 "적었는데 안 열리는" 줄이 `~/.ssh/config` 에 남는다.
pub(crate) fn multi_jump() -> String {
    tr!(
        ko: "여러 단계 경유는 아직 지원하지 않습니다",
        en: "Multiple jump hops are not supported yet"
    )
}

/// `~/.ssh/config` 의 별칭 하나를 실제 접속 파라미터로 편 것.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ConnectParams {
    pub host: String,
    pub port: u16,
    pub user: String,
    /// `None` 이면 keepalive 를 보내지 않는다 (ServerAliveInterval 0).
    pub keepalive_interval: Option<Duration>,
    pub keepalive_max: usize,
    /// 이 호스트의 `StrictHostKeyChecking`. 적히지 않았으면 `Yes` (= 항상 검증).
    pub strict: StrictHostKeyChecking,
    /// 이 호스트의 `UserKnownHostsFile /dev/null` — 수락한 키를 기록하지 않는다.
    pub no_host_key_store: bool,
    /// 이 호스트의 `IdentityFile` — **config 에 적힌 글자 그대로**다 (`~` 도 안 폈다).
    ///
    /// 여기서 파일을 찾지 않는 이유: [`resolve_params`] 는 **순수 함수**여야 유닛 테스트가
    /// 디스크를 타지 않는다. 후보를 실제 파일로 펴는 일은 접속하는 순간
    /// [`identity_candidates`] 가 따로 한다 (`~` 확장 · `.pub` 제외 · 있는 것만).
    pub identity_file: Option<String>,
    /// 이 호스트의 `IdentitiesOnly yes` — **적힌 키만** 낸다 (에이전트 키도, `~/.ssh` 기본
    /// 이름도 빼고). 적히지 않았으면 `false` = OpenSSH 기본값.
    /// 뜻을 실현하는 자리는 [`identity_candidates`] 와 [`agent_allowlist`] 둘뿐이다.
    pub identities_only: bool,
    /// 이 호스트의 `ForwardAgent yes` (config 병합값). 접속하는 순간 `sessions.toml` 의
    /// 호스트 덮어쓰기와 합쳐진다([`crate::agent_forward::effective`]) — 이 함수가 순수해야 해서
    /// 메타는 여기서 읽지 않는다. **경유 홉에는 없다** — 포워딩은 대상 셸 채널의 요청이다.
    /// 연결 공유의 열쇠([`transport_key`])에는 넣지 않는다: 허락은 전송로가 아니라 셸 채널마다
    /// 청하고, 받아들이는 판단은 전송로의 장부가 한다 (docs/log/2026-09-23-agent-forwarding.md).
    pub forward_agent: bool,
    /// `ProxyJump`. `None` 이면 대상에 직접 붙는다.
    pub jump: Option<JumpParams>,
}

/// 점프 호스트 한 대. **`jump` 필드가 없다는 것 자체가 1홉 제한**이다 —
/// 점프의 `ProxyJump` 는 타입 수준에서 표현할 수 없으므로 해석 단계에서 무시된다.
///
/// 호스트 키 관련 옵션은 **점프 자신의 별칭 블록에서** 온다 — 점프도 별개의 서버이므로
/// 대상의 완화가 점프까지 번지면 안 된다 (그 반대도 마찬가지).
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct JumpParams {
    /// 사용자가 `ProxyJump` 에 적은 이름 그대로 — 오류 문구에만 쓴다.
    pub label: String,
    pub host: String,
    pub port: u16,
    pub user: String,
    pub keepalive_interval: Option<Duration>,
    pub keepalive_max: usize,
    pub strict: StrictHostKeyChecking,
    pub no_host_key_store: bool,
    /// 경유 호스트 **자신의** `IdentityFile` (그 별칭 블록에서 온다 — 대상의 것이 아니다).
    /// 호스트 키 옵션과 같은 규칙이다: 경유도 별개의 서버다.
    pub identity_file: Option<String>,
    /// 경유 호스트 **자신의** `IdentitiesOnly` — 위와 같은 규칙이다. 대상이 켰다고 경유까지
    /// 좁히지 않고, 그 반대도 마찬가지다.
    pub identities_only: bool,
}

/// `ProxyJump` 값을 config 를 보기 **전에** 문자 그대로 쪼갠 것 — 순수 파싱 결과.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct JumpSpec {
    /// `user@` 부분. 없으면 config/환경에서 채운다.
    pub user: Option<String>,
    /// 별칭일 수도, 실제 호스트 이름일 수도 있다 — 판단은 [`resolve_jump`] 가 한다.
    pub host: String,
    /// `:port` 부분.
    pub port: Option<u16>,
}

/// `ProxyJump` 값 하나를 `[user@]host[:port]` 로 파싱한다 — **순수 함수** (유닛 테스트 대상).
///
/// `Ok(None)` 은 "점프 없음" 이다: 빈 값, 그리고 OpenSSH 가 상위 블록의 `ProxyJump` 를
/// 취소하는 데 쓰는 `none`.
///
/// 쉼표로 홉을 여러 개 적은 것(`ProxyJump a,b`)은 v1 범위 밖이라 거부한다 — 조용히
/// 첫 홉만 쓰면 사용자가 의도한 경로가 아닌 곳으로 트래픽이 나간다.
pub(super) fn parse_jump_spec(raw: &str) -> Result<Option<JumpSpec>, SshOpenError> {
    let value = raw.trim();
    if value.is_empty() || value.eq_ignore_ascii_case("none") {
        return Ok(None);
    }
    if value.contains(',') {
        return Err(SshOpenError::other(multi_jump()));
    }

    // 사용자 이름에는 `@` 가 들어가지 않으므로 OpenSSH 처럼 **마지막** `@` 에서 자른다.
    let (user, rest) = match value.rsplit_once('@') {
        Some((u, rest)) if !u.is_empty() => (Some(u.to_string()), rest),
        // `@host` 처럼 사용자가 빈 경우는 없는 것으로 본다.
        Some((_, rest)) => (None, rest),
        None => (None, value),
    };

    // `[::1]:2222` 대괄호 표기와 `host:2222` 를 모두 받는다. 대괄호 없는 IPv6 은
    // 콜론이 여러 개라 포트로 오해하면 안 되므로 통째로 호스트로 둔다.
    let (host, port_text) = if let Some(inner) = rest.strip_prefix('[') {
        match inner.split_once(']') {
            Some((h, tail)) => (h, tail.strip_prefix(':').filter(|p| !p.is_empty())),
            None => {
                return Err(SshOpenError::other(tr!(
                    ko: "경유 호스트 '{rest}' 의 대괄호가 닫히지 않았습니다",
                    en: "The bracket in jump host '{rest}' is never closed"
                )))
            }
        }
    } else if rest.matches(':').count() == 1 {
        let (h, p) = rest.split_once(':').unwrap_or((rest, ""));
        (h, (!p.is_empty()).then_some(p))
    } else {
        (rest, None)
    };

    if host.is_empty() {
        return Err(SshOpenError::other(tr!(
            ko: "ProxyJump '{raw}' 에서 호스트를 읽지 못했습니다",
            en: "Could not read a host out of ProxyJump '{raw}'"
        )));
    }

    let port = match port_text {
        Some(p) => Some(p.parse::<u16>().map_err(|_| {
            SshOpenError::other(tr!(
                ko: "경유 호스트 포트 '{p}' 을(를) 숫자로 해석할 수 없습니다",
                en: "Could not read jump host port '{p}' as a number"
            ))
        })?),
        None => None,
    };

    Ok(Some(JumpSpec {
        user,
        host: host.to_string(),
        port,
    }))
}

/// 파싱된 점프 조각을 실제 접속 파라미터로 편다 — **순수 함수** (유닛 테스트 대상).
///
/// 점프 이름이 config 의 별칭이면 그 블록을 그대로 쓴다 (HostName/User/Port/keepalive).
/// **다만 그 별칭의 `ProxyJump` 는 무시한다** — 1홉만 지원하므로 여기서 체인을 끊는다.
/// `ProxyJump user@host:port` 처럼 명시된 값은 별칭 값을 이긴다 (OpenSSH 와 동일).
///
/// 막는 것은 **진짜 순환 하나뿐**이다: 점프 별칭이 대상 별칭과 같은 경우
/// (대소문자 무시 — 호스트 폼의 검사와 같은 꼴, [`crate::config_edit`]).
/// 해석된 `host:port` 로는 판단하지 않는다 — 별칭 둘이 같은 서버를 가리키는 것은
/// OpenSSH 에서 정상적인 구성이고(`bastion` 과 `SSH` 가 둘 다 `localhost:1220`),
/// 거기서 한 별칭을 거쳐 다른 별칭으로 붙는 것도 마찬가지다.
fn resolve_jump(
    raw: &str,
    alias: &str,
    hosts: &[HostEntry],
    fallback_user: Option<&str>,
) -> Result<Option<JumpParams>, SshOpenError> {
    let Some(spec) = parse_jump_spec(raw)? else {
        return Ok(None);
    };

    if spec.host.eq_ignore_ascii_case(alias) {
        return Err(SshOpenError::other(tr!(
            ko: "ProxyJump 가 자기 자신('{alias}')을 가리킵니다",
            en: "ProxyJump points at itself ('{alias}')"
        )));
    }

    let entry = hosts
        .iter()
        .find(|h| h.name.eq_ignore_ascii_case(&spec.host));

    let host = entry
        .and_then(|e| e.host_name.clone())
        .filter(|h| !h.is_empty())
        .unwrap_or_else(|| spec.host.clone());

    let port = spec
        .port
        .or_else(|| entry.and_then(|e| e.port))
        .unwrap_or(22);

    let user = spec
        .user
        .or_else(|| entry.and_then(|e| e.user.clone()))
        .or_else(|| fallback_user.map(str::to_string))
        .filter(|u| !u.is_empty())
        .ok_or_else(|| {
            SshOpenError::other(tr!(
                ko: "경유 호스트 {host} 의 사용자 이름을 알 수 없습니다 — ssh config 에 User 를 적으세요",
                en: "Cannot tell the user name for jump host {host} — add User to your ssh config",
                host = spec.host
            ))
        })?;

    let interval = entry
        .and_then(|e| e.server_alive_interval)
        .map(u64::from)
        .unwrap_or(DEFAULT_KEEPALIVE_SECS);

    Ok(Some(JumpParams {
        label: spec.host,
        host,
        port,
        user,
        keepalive_interval: (interval > 0).then(|| Duration::from_secs(interval)),
        keepalive_max: entry
            .and_then(|e| e.server_alive_count_max)
            .map(|n| n as usize)
            .unwrap_or(DEFAULT_KEEPALIVE_MAX),
        // 점프 별칭이 config 에 없으면 (= 그냥 호스트 이름을 적은 것) 기본값 = 항상 검증.
        strict: entry
            .map(|e| e.strict_host_key_checking)
            .unwrap_or_default(),
        no_host_key_store: entry.is_some_and(|e| e.no_host_key_store),
        identity_file: entry.and_then(|e| e.identity_file.clone()),
        identities_only: entry.is_some_and(|e| e.identities_only),
    }))
}

// ---------------------------------------------------------------------------
// IdentityFile — 후보 경로 (docs/log/2026-09-19-identity-file-auth.md)
// ---------------------------------------------------------------------------

/// OpenSSH 가 `IdentityFile` 이 없을 때 차례로 보는 이름들. 순서가 곧 우선순위다.
/// (`id_dsa` 는 뺐다 — 요즘 서버가 받지 않고, 있는 파일을 내면 `MaxAuthTries` 만 태운다.)
const DEFAULT_IDENTITIES: [&str; 3] = ["id_ed25519", "id_ecdsa", "id_rsa"];

/// `~/…` · `~\…` 를 홈으로 편다 — **순수 함수**. 홈을 모르면 글자 그대로 둔다.
///
/// OpenSSH 와 달리 `~user/` 는 풀지 않는다(윈도우에 상대가 없다). 그 모양은 경로 그대로
/// 넘어가고, 없는 파일이면 후보에서 조용히 빠진다.
fn expand_tilde(raw: &str, home: Option<&Path>) -> PathBuf {
    let trimmed = raw.trim().trim_matches('"');
    let Some(home) = home else {
        return PathBuf::from(trimmed);
    };
    match trimmed.strip_prefix('~') {
        Some("") => home.to_path_buf(),
        Some(rest) if rest.starts_with('/') || rest.starts_with('\\') => {
            home.join(rest.trim_start_matches(['/', '\\']))
        }
        _ => PathBuf::from(trimmed),
    }
}

/// 경로를 `~/…` 로 줄인다 — **순수 함수**. 화면에 보이는 글자 전용
/// (`AuthUsed::identity` · 상태 말풍선). 홈 밖이면 그대로 둔다.
pub(super) fn shorten_home(path: &Path, home: Option<&Path>) -> String {
    let full = path.display().to_string();
    let Some(home) = home else { return full };
    match path.strip_prefix(home) {
        // 구분자는 **원래 경로의 것**을 쓴다 — 윈도우에서 `~/…` 와 `~\…` 를 섞지 않는다.
        Ok(rest) => format!("~/{}", rest.display()).replace('\\', "/"),
        Err(_) => full,
    }
}

/// 같은 키 파일을 두 번 내지 않기 위한 **경로 비교** — 순수 함수.
///
/// `Path` 의 컴포넌트 비교가 `/`·`\` 차이는 이미 흡수하지만, **대소문자는 파일 시스템의
/// 성질**이라 여기서 OS 로 가른다. 윈도우에서 `~/.ssh/ID_ed25519` 와 `id_ed25519` 는 같은
/// 파일이고, 그 둘을 따로 세면 서버의 `MaxAuthTries` 를 공짜로 태운다.
fn same_key_path(a: &Path, b: &Path) -> bool {
    #[cfg(windows)]
    {
        let norm = |p: &Path| p.to_string_lossy().replace('\\', "/");
        norm(a).eq_ignore_ascii_case(&norm(b))
    }
    // Linux·macOS: 대소문자를 구분하는 파일 시스템이 기본이다. macOS 의 대소문자 무시
    // 볼륨은 여기서 후보 하나가 더 날 뿐이라(중복 제출) 이 스텁으로 충분하다.
    #[cfg(not(windows))]
    {
        a == b
    }
}

/// **이 홉에서 내 볼 개인키 파일들** — 순수 함수(존재 판정은 인자로 들어온다).
///
/// 순서는 **적힌 것 먼저, 기본 이름은 그 뒤**다.
///
/// 1. `IdentityFile` 에 적힌 것 (`~` 확장 · 따옴표 제거 · 있는 것만). config 파서가 아직
///    한 줄만 읽어서 지금은 최대 하나다.
/// 2. 이어서 `~/.ssh` 의 기본 이름들(`id_ed25519` → `id_ecdsa` → `id_rsa`) 중 있는 것.
///    **1 에 이미 든 파일은 다시 넣지 않는다** ([`same_key_path`] 로 비교).
///
/// ## `IdentitiesOnly yes` (2026-09-19)
///
/// 켜져 있고 **`IdentityFile` 이 적혀 있으면** 2 를 붙이지 않는다 — 적힌 것뿐이다.
/// 적힌 줄이 **하나도 없으면** 켜져 있어도 2 는 그대로 탄다: OpenSSH 의 이 옵션이 빼는 것은
/// **에이전트 키**이고, 기본 이름은 `IdentityFile` 을 하나라도 적었을 때만 빠진다
/// (`readconf.c` 의 `num_identity_files == 0`). 그래서 여기서도 판정 기준은 "적혀 있는가"
/// 이지 "그 파일이 있는가" 가 아니다 — `IdentitiesOnly yes` + 지워진 `IdentityFile` 은
/// 후보가 **비는 것이 맞다**(사용자가 그 키만 쓰라고 적었다).
///
/// 2026-09-19 첫 판은 1 이 있으면 2 를 **대체**했는데, `IdentityFile` 이 **지워진 파일**을
/// 가리키는 호스트에서 후보가 통째로 비어 **키를 하나도 내지 않았다** — 에이전트에 없는
/// `~/.ssh/id_ed25519` 가 그 서버에 이미 설치돼 있었는데도 설치 확인이 "건너뜀" 이었다.
/// 적힌 줄은 **우선순위**이지 다른 키를 금지하는 문장이 아니므로, 기본 이름은 **뒤에
/// 덧붙는 폴백**으로 남긴다. 늘어난 후보가 `MaxAuthTries` 를 태우는 것은 최대 셋이고,
/// 에이전트가 이미 낸 키는 [`drop_keys_in_agent`] 가 지문으로 먼저 뺀다.
///
/// 거르는 것 둘.
/// - **`.pub` 은 후보가 아니다.** 공개키로는 서명할 수 없고, `IdentityFile ~/…​.pub` 은
///   "에이전트에게 이 키로 서명을 부탁하라" 는 다른 뜻이다(그 일은 이미 에이전트 단계가 한다).
/// - **없는 파일은 조용히 뺀다.** 여기서 오류로 올리면 `IdentityFile` 이 낡은 호스트가
///   비밀번호로도 못 붙는다 — 이 단계는 에이전트가 실패한 뒤의 **추가 시도**이지 관문이 아니다.
///   (있는데 못 읽는 파일은 다르다 — 그것은 [`OpenCause::KeyFileUnreadable`] 로 남는다.)
pub(super) fn identity_candidates(
    configured: Option<&str>,
    identities_only: bool,
    home: Option<&Path>,
    exists: &dyn Fn(&Path) -> bool,
) -> Vec<PathBuf> {
    fn push(out: &mut Vec<PathBuf>, path: PathBuf, exists: &dyn Fn(&Path) -> bool) {
        let is_pub = path.extension().and_then(|e| e.to_str()) == Some("pub");
        if is_pub || !exists(&path) || out.iter().any(|q| same_key_path(q, &path)) {
            return;
        }
        out.push(path);
    }

    let configured = configured.map(str::trim).filter(|s| !s.is_empty());
    let mut out = Vec::new();
    if let Some(raw) = configured {
        push(&mut out, expand_tilde(raw, home), exists);
    }
    // 적힌 줄이 있고 `IdentitiesOnly yes` 면 여기서 끝난다 — 기본 이름 폴백은 없다.
    if identities_only && configured.is_some() {
        return out;
    }
    if let Some(home) = home {
        for name in DEFAULT_IDENTITIES {
            push(&mut out, home.join(".ssh").join(name), exists);
        }
    }
    out
}

/// `IdentitiesOnly yes` 에서 **에이전트가 낼 수 있는 키의 지문 목록** — 순수 함수.
///
/// `None` 이면 제한 없음(예전 그대로 에이전트의 모든 키를 낸다). `Some(list)` 면 그 지문을
/// 가진 키만 낸다 — OpenSSH 도 `IdentitiesOnly yes` 에서 에이전트 키를 **거르되, 그 키가
/// 지정한 `IdentityFile` 과 같은 키면 에이전트에게 서명을 맡긴다**. 우리도 같게 한다:
/// 이미 에이전트에 들어 있는 키라면 암호구를 다시 묻지 않는 쪽이 옳다.
///
/// 지문은 짝이 되는 `.pub` 에서 온다. **`.pub` 이 없는 후보는 목록에 들지 못한다** —
/// 그 키는 에이전트 단계에서 빠지고 `ssh/auth.rs` 의 `authenticate_with_key_files` 가 파일에서 직접 연다
/// (모르면 빼는 쪽이 맞다: 여기서 남기면 *다른* 키를 내 버린다).
pub(super) fn agent_allowlist(
    identities_only: bool,
    candidates: &[PathBuf],
    fingerprint_of: &dyn Fn(&Path) -> Option<String>,
) -> Option<Vec<String>> {
    identities_only.then(|| {
        candidates
            .iter()
            .filter_map(|p| fingerprint_of(p))
            .collect()
    })
}

/// 에이전트가 **이미 낸** 키와 같은 파일은 뺀다 — 순수 함수(지문 계산은 인자로 들어온다).
///
/// 같은 키를 두 번 내면 서버의 `MaxAuthTries`(기본 6)를 공짜로 태운다. 그리고 두 번째
/// 거절이 첫 번째와 구분되지 않아 "이 키는 서버가 모른다" 는 사실이 흐려진다.
///
/// 지문을 모르는 파일(`.pub` 이 없거나 읽히지 않는다)은 **남긴다** — 모르면 내 보는 쪽이
/// 맞다(빼면 붙을 수 있는 키를 잃는다).
pub(super) fn drop_keys_in_agent(
    candidates: Vec<PathBuf>,
    agent_fingerprints: &[String],
    fingerprint_of: &dyn Fn(&Path) -> Option<String>,
) -> Vec<PathBuf> {
    if agent_fingerprints.is_empty() {
        return candidates;
    }
    candidates
        .into_iter()
        .filter(|p| match fingerprint_of(p) {
            Some(fp) => !agent_fingerprints.contains(&fp),
            None => true,
        })
        .collect()
}

/// 별칭을 접속 파라미터로 해석한다.
///
/// - 설정에 없는 별칭은 OpenSSH 와 같이 **호스트 이름 그 자체**로 취급한다.
/// - `User` 가 없으면 `fallback_user`(윈도우의 `USERNAME`)를 쓴다.
/// - `ProxyJump` 가 있으면 [`resolve_jump`] 로 한 홉만 편다.
pub(crate) fn resolve_params(
    alias: &str,
    hosts: &[HostEntry],
    fallback_user: Option<&str>,
) -> Result<ConnectParams, SshOpenError> {
    let entry = hosts.iter().find(|h| h.name.eq_ignore_ascii_case(alias));

    let host = entry
        .and_then(|e| e.host_name.clone())
        .filter(|h| !h.is_empty())
        .unwrap_or_else(|| alias.to_string());

    let port = entry.and_then(|e| e.port).unwrap_or(22);

    let user = entry
        .and_then(|e| e.user.clone())
        .or_else(|| fallback_user.map(str::to_string))
        .filter(|u| !u.is_empty())
        .ok_or_else(|| {
            SshOpenError::other(tr!(
                ko: "접속할 사용자 이름을 알 수 없습니다 — ssh config 에 User 를 적거나 USERNAME 환경 변수를 설정하세요",
                en: "Cannot tell which user name to connect with — add User to your ssh config or set the USERNAME environment variable"
            ))
        })?;

    let jump = match entry.and_then(|e| e.proxy_jump.as_deref()) {
        Some(raw) => resolve_jump(raw, alias, hosts, fallback_user)?,
        None => None,
    };

    let interval = entry
        .and_then(|e| e.server_alive_interval)
        .map(u64::from)
        .unwrap_or(DEFAULT_KEEPALIVE_SECS);

    Ok(ConnectParams {
        host,
        port,
        user,
        // 0 은 OpenSSH 에서 "keepalive 끄기" 다.
        keepalive_interval: (interval > 0).then(|| Duration::from_secs(interval)),
        keepalive_max: entry
            .and_then(|e| e.server_alive_count_max)
            .map(|n| n as usize)
            .unwrap_or(DEFAULT_KEEPALIVE_MAX),
        // **보안 원칙**: 완화는 사용자가 자기 config 의 그 블록에 직접 적은 호스트에만
        // 생긴다. 별칭이 config 에 없거나 옵션을 안 적었으면 언제나 yes = 항상 검증이다.
        strict: entry
            .map(|e| e.strict_host_key_checking)
            .unwrap_or_default(),
        no_host_key_store: entry.is_some_and(|e| e.no_host_key_store),
        // 글자 그대로 싣는다 (`~` 도 안 편다) — 이 함수는 디스크를 보지 않는다.
        identity_file: entry.and_then(|e| e.identity_file.clone()),
        identities_only: entry.is_some_and(|e| e.identities_only),
        forward_agent: entry.is_some_and(|e| e.forward_agent),
        jump,
    })
}
