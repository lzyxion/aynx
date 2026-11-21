//! 접속 파라미터 해석 — 별칭 · 빠른 접속 대상 → [`ConnectParams`]. 네트워크는 만지지 않는다.

use std::path::{Path, PathBuf};
use std::time::Duration;

use crate::i18n::tr;
use crate::ssh_config::{HostEntry, StrictHostKeyChecking};

use super::*;

/// ServerAliveInterval 기본값 — OpenSSH 는 0(끔)이지만 우리는 기본을 켜 둔다.
pub(super) const DEFAULT_KEEPALIVE_SECS: u64 = 30;
pub(super) const DEFAULT_KEEPALIVE_MAX: usize = 3;

// ---------------------------------------------------------------------------
// 빠른 접속 대상
// ---------------------------------------------------------------------------

/// `~/.ssh/config` 에 항목이 없는 그 자리 접속 대상 — 문법과 거절 규칙은 프런트 `src/lib/quick-connect.ts` 가 단일 진실이다.
#[derive(Debug, Clone, serde::Deserialize)]
pub struct AdhocTarget {
    pub host: String,
    pub user: Option<String>,
    pub port: Option<u16>,
}

/// **config 를 보지 않는다** — 설정에 없는 별칭과 같이 전부 기본값이고 호스트 키 검증은 **언제나 켜짐**이다.
/// 완화(`no` · `accept-new`)는 사용자가 자기 config 의 그 호스트 블록에 직접 적었을 때만 생기는데, 빠른 접속에는 그 블록이 없다.
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
        identity_file: None,
        identities_only: false,
        // 빠른 접속은 에이전트를 넘기지 않는다 — 켜는 자리(호스트 폼)가 없는 대상이다.
        forward_agent: false,
        jump: None,
    })
}

// ---------------------------------------------------------------------------
// 접속 파라미터 해석
// ---------------------------------------------------------------------------

/// **호스트 폼도 이 한 줄을 쓴다**([`crate::config_edit`]) — 접속이 거절할 값을 저장부터 막지 않으면 "적었는데 안 열리는" 줄이 `~/.ssh/config` 에 남는다.
pub(crate) fn multi_jump() -> String {
    tr!(
        ko: "여러 단계 경유는 아직 지원하지 않습니다",
        en: "Multiple jump hops are not supported yet"
    )
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ConnectParams {
    pub host: String,
    pub port: u16,
    pub user: String,
    /// `None` 이면 keepalive 를 보내지 않는다(ServerAliveInterval 0).
    pub keepalive_interval: Option<Duration>,
    pub keepalive_max: usize,
    /// 적히지 않았으면 `Yes`(= 항상 검증).
    pub strict: StrictHostKeyChecking,
    /// `UserKnownHostsFile /dev/null` — 수락한 키를 기록하지 않는다.
    pub no_host_key_store: bool,
    /// **config 에 적힌 글자 그대로**다(`~` 도 안 폈다) — 이 해석은 디스크를 보지 않는 순수 함수다.
    pub identity_file: Option<String>,
    /// 뜻을 실현하는 자리는 [`identity_candidates`] 와 [`agent_allowlist`] 둘뿐이다.
    pub identities_only: bool,
    /// config 병합값 — 접속하는 순간 `sessions.toml` 의 호스트 덮어쓰기와 합쳐진다([`crate::agent_forward::effective`]).
    /// **경유 홉에는 없다** — 포워딩은 대상 셸 채널의 요청이다. 연결 공유의 열쇠([`transport_key`])에는 넣지 않는다 —
    /// 허락은 셸 채널마다 청하고 받아들이는 판단은 전송로의 장부가 한다(docs/log/2026-09-23-agent-forwarding.md).
    pub forward_agent: bool,
    pub jump: Option<JumpParams>,
}

/// **`jump` 필드가 없다는 것 자체가 1홉 제한**이다.
/// 호스트 키 · `IdentityFile` · `IdentitiesOnly` 는 **점프 자신의 별칭 블록에서** 온다 — 대상의 완화가 점프까지 번지면 안 된다(그 반대도).
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct JumpParams {
    /// 오류 문구에만 쓴다.
    pub label: String,
    pub host: String,
    pub port: u16,
    pub user: String,
    pub keepalive_interval: Option<Duration>,
    pub keepalive_max: usize,
    pub strict: StrictHostKeyChecking,
    pub no_host_key_store: bool,
    pub identity_file: Option<String>,
    pub identities_only: bool,
}

/// `ProxyJump` 값을 config 를 보기 **전에** 문자 그대로 쪼갠 것.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct JumpSpec {
    pub user: Option<String>,
    /// 별칭일 수도, 실제 호스트 이름일 수도 있다.
    pub host: String,
    pub port: Option<u16>,
}

/// `none` 은 OpenSSH 가 상위 블록의 `ProxyJump` 를 취소하는 값이다.
/// 여러 홉은 거부한다 — 조용히 첫 홉만 쓰면 사용자가 의도한 경로가 아닌 곳으로 트래픽이 나간다.
pub(super) fn parse_jump_spec(raw: &str) -> Result<Option<JumpSpec>, SshOpenError> {
    let value = raw.trim();
    if value.is_empty() || value.eq_ignore_ascii_case("none") {
        return Ok(None);
    }
    if value.contains(',') {
        return Err(SshOpenError::other(multi_jump()));
    }

    // OpenSSH 처럼 **마지막** `@` 에서 자른다.
    let (user, rest) = match value.rsplit_once('@') {
        Some((u, rest)) if !u.is_empty() => (Some(u.to_string()), rest),
        Some((_, rest)) => (None, rest),
        None => (None, value),
    };

    // 대괄호 없는 IPv6 은 콜론이 여러 개라 포트로 오해하면 안 되므로 통째로 호스트로 둔다.
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

/// 점프 별칭의 `ProxyJump` 는 무시한다(1홉에서 체인을 끊는다) · 명시한 `user@host:port` 는 별칭 값을 이긴다(OpenSSH 와 같다).
/// 막는 것은 **진짜 순환 하나뿐**이다(대상 별칭과 같은 이름 — 호스트 폼의 검사와 같은 꼴, [`crate::config_edit`]).
/// 해석된 `host:port` 로는 판단하지 않는다 — 별칭 둘이 같은 서버를 가리키는 것은 정상 구성이다.
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
        // 점프 별칭이 config 에 없으면 기본값 = 항상 검증.
        strict: entry
            .map(|e| e.strict_host_key_checking)
            .unwrap_or_default(),
        no_host_key_store: entry.is_some_and(|e| e.no_host_key_store),
        identity_file: entry.and_then(|e| e.identity_file.clone()),
        identities_only: entry.is_some_and(|e| e.identities_only),
    }))
}

// ---------------------------------------------------------------------------
// IdentityFile — 후보 경로
// ---------------------------------------------------------------------------

/// 순서가 곧 우선순위다. `id_dsa` 는 넣지 않는다 — 요즘 서버가 받지 않고 `MaxAuthTries` 만 태운다.
const DEFAULT_IDENTITIES: [&str; 3] = ["id_ed25519", "id_ecdsa", "id_rsa"];

/// OpenSSH 와 달리 `~user/` 는 풀지 않는다(윈도우에 상대가 없다).
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

/// 화면에 보이는 글자 전용.
pub(super) fn shorten_home(path: &Path, home: Option<&Path>) -> String {
    let full = path.display().to_string();
    let Some(home) = home else { return full };
    match path.strip_prefix(home) {
        Ok(rest) => format!("~/{}", rest.display()).replace('\\', "/"),
        Err(_) => full,
    }
}

/// 대소문자는 파일 시스템의 성질이라 OS 로 가른다 — 윈도우에서 같은 키를 따로 세면 서버의 `MaxAuthTries` 를 공짜로 태운다.
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

/// 이 홉에서 내 볼 개인키 파일들 — 적힌 것 먼저, 기본 이름은 그 뒤(적힌 줄은 우선순위이지 다른 키를 금지하는 문장이 아니다).
///
/// - `IdentitiesOnly yes` 는 **적혀 있을 때만** 기본 이름을 뺀다(OpenSSH `readconf.c` 의 `num_identity_files == 0` 과 같다) — 판정은
///   "적혀 있는가" 이지 "그 파일이 있는가" 가 아니다. `IdentitiesOnly yes` + 지워진 `IdentityFile` 은 후보가 비는 것이 맞다.
/// - `.pub` 은 후보가 아니다 — `IdentityFile ~/….pub` 은 "에이전트에게 서명을 부탁하라" 는 다른 뜻이다.
/// - 없는 파일은 조용히 뺀다 — 오류로 올리면 `IdentityFile` 이 낡은 호스트가 비밀번호로도 못 붙는다(이 단계는 관문이 아니라 추가 시도다).
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

/// `IdentitiesOnly yes` 에서 에이전트가 낼 수 있는 키의 지문 목록(`None` = 제한 없음) — 지정한 `IdentityFile` 과 같은 키면 에이전트에게 서명을 맡긴다(OpenSSH 와 같다).
/// 지문은 짝 `.pub` 에서 온다 — `.pub` 이 없는 후보는 목록에 들지 못한다(모르면 빼는 쪽이 맞다 — 남기면 *다른* 키를 내 버린다).
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

/// 같은 키를 두 번 내면 서버의 `MaxAuthTries` 를 공짜로 태운다. 지문을 모르는 파일은 **남긴다** — 빼면 붙을 수 있는 키를 잃는다.
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

/// 설정에 없는 별칭은 OpenSSH 와 같이 호스트 이름 그 자체로 취급한다.
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
        keepalive_interval: (interval > 0).then(|| Duration::from_secs(interval)),
        keepalive_max: entry
            .and_then(|e| e.server_alive_count_max)
            .map(|n| n as usize)
            .unwrap_or(DEFAULT_KEEPALIVE_MAX),
        // **보안 원칙**: 완화는 사용자가 자기 config 의 그 블록에 직접 적은 호스트에만 생긴다 — 아니면 언제나 항상 검증.
        strict: entry
            .map(|e| e.strict_host_key_checking)
            .unwrap_or_default(),
        no_host_key_store: entry.is_some_and(|e| e.no_host_key_store),
        identity_file: entry.and_then(|e| e.identity_file.clone()),
        identities_only: entry.is_some_and(|e| e.identities_only),
        forward_agent: entry.is_some_and(|e| e.forward_agent),
        jump,
    })
}
