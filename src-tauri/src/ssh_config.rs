//! `~/.ssh/config` 파서 — OpenSSH 의 first-obtained-value-wins 의미론 · 최소 옵션 집합.
//! 지원하지 않는 지시어(Include/Match/부정 패턴)는 조용히 버리지 않고 `warnings` 로 올려 보낸다.
//!
//! **읽기만 한다** — 사용자 소유 파일(ssh·scp·git·VS Code 가 함께 읽는다)이라 쓰기는 `crate::config_edit` 의 국소 패치뿐이다.

use crate::i18n::tr;
use crate::sessions_meta::{HostMeta, SessionsMeta};

/// 완화는 **사용자가 자기 `~/.ssh/config` 에 적었을 때만** 생긴다 — 없으면 언제나 `Yes` 이고 앱이 스스로 완화하는 경로는 없다.
/// `Ask` 는 `Yes` 와 동작이 같지만 사용자가 적은 값을 그대로 보여 주려고 따로 둔다.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum StrictHostKeyChecking {
    #[default]
    Yes,
    No,
    /// 바뀐 키는 여전히 거부한다.
    AcceptNew,
    Ask,
}

impl StrictHostKeyChecking {
    fn parse(value: &str) -> Option<Self> {
        match value.to_ascii_lowercase().as_str() {
            "yes" => Some(StrictHostKeyChecking::Yes),
            "no" => Some(StrictHostKeyChecking::No),
            "accept-new" => Some(StrictHostKeyChecking::AcceptNew),
            "ask" => Some(StrictHostKeyChecking::Ask),
            _ => None,
        }
    }

    pub fn skips_verification(self) -> bool {
        matches!(self, StrictHostKeyChecking::No)
    }

    /// 바뀐 키(Changed)는 이 값으로도 뚫리지 않는다.
    pub fn auto_accepts_new(self) -> bool {
        matches!(self, StrictHostKeyChecking::AcceptNew)
    }
}

fn is_null_known_hosts(value: &str) -> bool {
    value.eq_ignore_ascii_case("/dev/null") || value.eq_ignore_ascii_case("none")
}

#[derive(Debug, Clone, Default, serde::Serialize)]
pub struct HostEntry {
    pub name: String,
    pub host_name: Option<String>,
    pub user: Option<String>,
    pub port: Option<u16>,
    pub identity_file: Option<String>,
    /// `IdentityFile` 을 하나도 적지 않은 호스트에서는 켜져 있어도 기본 이름은 그대로 쓴다 — OpenSSH 와 같다(`ssh::identity_candidates`).
    pub identities_only: bool,
    /// 이 호스트의 블록에 실제로 적힌 값(`Host *` 빼고) — 호스트 폼용. 폼을 병합값으로 채우면 물려받은 값이 저장 순간
    /// 이 블록에 굳어 상속이 끊긴다. 접속은 언제나 병합값([`HostEntry::identities_only`])을 본다.
    pub identities_only_own: bool,
    /// 병합값이다. 접속이 실제로 보는 값은 `sessions.toml` 의 `forward_agent`(있으면 이긴다)와 합친 것이다([`crate::agent_forward::effective`]).
    pub forward_agent: bool,
    pub proxy_jump: Option<String>,
    pub server_alive_interval: Option<u32>,
    pub server_alive_count_max: Option<u32>,
    pub strict_host_key_checking: StrictHostKeyChecking,
    /// `UserKnownHostsFile /dev/null`(또는 `none`) — 임의 경로는 지원하지 않는다(경고 후 기본 파일).
    pub no_host_key_store: bool,
    /// 프런트 계약 — flatten 하지 않고 중첩 필드로 내보낸다(`host.meta.color`). `parse()` 만 부르면 비어 있다.
    pub meta: HostMeta,
}

#[derive(Debug, Clone, Default, serde::Serialize)]
pub struct SshConfig {
    pub hosts: Vec<HostEntry>,
    pub warnings: Vec<String>,
}

struct Opt {
    key: String,
    value: String,
}

struct Block {
    patterns: Vec<String>,
    options: Vec<Opt>,
}

const SUPPORTED: [&str; 11] = [
    "hostname",
    "user",
    "port",
    "identityfile",
    "identitiesonly",
    "forwardagent",
    "proxyjump",
    "serveraliveinterval",
    "serveralivecountmax",
    "stricthostkeychecking",
    "userknownhostsfile",
];

const STORE_NONE: &str = "none";
const STORE_DEFAULT: &str = "default";

pub fn parse(content: &str) -> SshConfig {
    let mut warnings: Vec<String> = Vec::new();

    let mut blocks: Vec<Block> = vec![Block {
        patterns: vec!["*".to_string()],
        options: Vec::new(),
    }];
    let mut current = 0usize;
    // Match 블록 안의 옵션은 앞 Host 블록으로 새지 않도록 통째로 버린다.
    let mut in_match = false;

    for (idx, raw) in content.lines().enumerate() {
        let line = idx + 1;
        let Some((key, rest)) = split_line(raw) else {
            continue;
        };

        match key.to_ascii_lowercase().as_str() {
            "host" => {
                in_match = false;
                let mut patterns = Vec::new();
                for pattern in tokenize(&rest) {
                    if pattern.starts_with('#') {
                        break;
                    }
                    if pattern.starts_with('!') {
                        warnings.push(tr!(
                            ko: "line {line}: 부정 패턴 '{pattern}' 은 지원하지 않습니다 — 무시하고 나머지 패턴만 적용합니다",
                            en: "line {line}: the negated pattern '{pattern}' is not supported — it is ignored and the remaining patterns apply"
                        ));
                        continue;
                    }
                    patterns.push(pattern);
                }
                if patterns.is_empty() {
                    warnings.push(tr!(
                        ko: "line {line}: Host 줄에 쓸 수 있는 패턴이 없습니다 — 블록을 건너뜁니다",
                        en: "line {line}: the Host line has no usable pattern — the block is skipped"
                    ));
                    // 뒤따르는 옵션이 이전 블록에 섞이지 않도록 버린다.
                    in_match = true;
                    continue;
                }
                blocks.push(Block {
                    patterns,
                    options: Vec::new(),
                });
                current = blocks.len() - 1;
            }
            "match" => {
                warnings.push(tr!(
                    ko: "line {line}: Match 는 지원하지 않습니다 — 이 블록의 옵션은 적용되지 않습니다",
                    en: "line {line}: Match is not supported — the options in this block do not apply"
                ));
                in_match = true;
            }
            "include" => {
                warnings.push(tr!(
                    ko: "line {line}: Include 는 지원하지 않습니다 — 해당 파일의 호스트는 목록에 나타나지 않습니다",
                    en: "line {line}: Include is not supported — hosts from that file do not appear in the list"
                ));
            }
            lower => {
                if in_match {
                    continue;
                }
                if !SUPPORTED.contains(&lower) {
                    continue;
                }
                let Some(value) = first_value(&rest) else {
                    warnings.push(tr!(
                        ko: "line {line}: {key} 에 값이 없습니다 — 무시합니다",
                        en: "line {line}: {key} has no value — it is ignored"
                    ));
                    continue;
                };
                // 값 검증은 여기서 한 번만 한다(해석 단계에서 하면 호스트 수만큼 경고가 중복된다).
                let Some(value) = normalize(lower, &key, value, line, &mut warnings) else {
                    continue;
                };
                blocks[current].options.push(Opt {
                    key: lower.to_string(),
                    value,
                });
            }
        }
    }

    let mut names: Vec<String> = Vec::new();
    for block in &blocks {
        for pattern in &block.patterns {
            if is_concrete(pattern) && !names.iter().any(|n| n == pattern) {
                names.push(pattern.clone());
            }
        }
    }

    let hosts = names
        .into_iter()
        .map(|name| resolve(&name, &blocks))
        .collect();

    SshConfig { hosts, warnings }
}

/// `None` 이면 그 줄은 버려진다(다음 값이 first-wins 를 이어받는다). 보안 옵션은 **버리지 않고** 안전한 값으로 접는다 —
/// 사용자가 적은 줄이 슬롯을 차지해야 뒤따르는 `Host *` 의 완화 값이 이기지 못한다.
fn normalize(
    lower: &str,
    key: &str,
    value: String,
    line: usize,
    warnings: &mut Vec<String>,
) -> Option<String> {
    match lower {
        "port" if value.parse::<u16>().is_err() => {
            warnings.push(tr!(
                ko: "line {line}: {key} 값 '{value}' 을(를) 숫자로 해석할 수 없습니다 — 무시합니다",
                en: "line {line}: the {key} value '{value}' is not a number — it is ignored"
            ));
            None
        }
        "serveraliveinterval" | "serveralivecountmax" if value.parse::<u32>().is_err() => {
            warnings.push(tr!(
                ko: "line {line}: {key} 값 '{value}' 을(를) 숫자로 해석할 수 없습니다 — 무시합니다",
                en: "line {line}: the {key} value '{value}' is not a number — it is ignored"
            ));
            None
        }
        // 모르는 값은 버린다 — 이 옵션에는 완화 방향이 없어 슬롯을 비워 둬도 새지 않는다.
        "identitiesonly" => match value.to_ascii_lowercase().as_str() {
            "yes" => Some("yes".to_string()),
            "no" => Some("no".to_string()),
            _ => {
                warnings.push(tr!(
                    ko: "line {line}: IdentitiesOnly 값 '{value}' 을(를) 알 수 없습니다 \
                         — yes 또는 no 만 씁니다 (무시합니다)",
                    en: "line {line}: the IdentitiesOnly value '{value}' is unknown \
                         — only yes or no are accepted (it is ignored)"
                ));
                None
            }
        },
        // 소켓 경로·`$환경변수` 를 `yes` 로 접지 않는다 — 중계는 이 PC 의 기본 에이전트 하나라 사용자가 적은 것과 다른
        // 에이전트가 서명하게 된다. 버리면 꺼지는 쪽이라 새는 것이 없다.
        "forwardagent" => match value.to_ascii_lowercase().as_str() {
            "yes" => Some("yes".to_string()),
            "no" => Some("no".to_string()),
            _ => {
                warnings.push(tr!(
                    ko: "line {line}: ForwardAgent 값 '{value}' 은(는) 지원하지 않습니다                          — yes 또는 no 만 씁니다 (무시합니다)",
                    en: "line {line}: the ForwardAgent value '{value}' is not supported                          — only yes or no are accepted (it is ignored)"
                ));
                None
            }
        },
        "stricthostkeychecking" => match StrictHostKeyChecking::parse(&value) {
            Some(_) => Some(value.to_ascii_lowercase()),
            None => {
                warnings.push(tr!(
                    ko: "line {line}: StrictHostKeyChecking 값 '{value}' 을(를) 알 수 없습니다 \
                         — 안전한 쪽인 yes 로 취급합니다",
                    en: "line {line}: the StrictHostKeyChecking value '{value}' is unknown \
                         — it is treated as yes, the safe side"
                ));
                Some("yes".to_string())
            }
        },
        "userknownhostsfile" => {
            if is_null_known_hosts(&value) {
                Some(STORE_NONE.to_string())
            } else {
                warnings.push(tr!(
                    ko: "line {line}: UserKnownHostsFile 은 /dev/null 만 지원합니다 \
                         — '{value}' 대신 기본 파일(~/.ssh/known_hosts)을 씁니다",
                    en: "line {line}: UserKnownHostsFile only supports /dev/null \
                         — the default file (~/.ssh/known_hosts) is used instead of '{value}'"
                ));
                Some(STORE_DEFAULT.to_string())
            }
        }
        _ => Some(value),
    }
}

fn resolve(name: &str, blocks: &[Block]) -> HostEntry {
    let mut entry = HostEntry {
        name: name.to_string(),
        ..HostEntry::default()
    };
    let mut strict: Option<StrictHostKeyChecking> = None;
    let mut no_store: Option<bool> = None;
    let mut identities_only: Option<bool> = None;
    let mut identities_only_own: Option<bool> = None;
    let mut forward_agent: Option<bool> = None;

    for block in blocks {
        if !block.patterns.iter().any(|p| matches_pattern(p, name)) {
            continue;
        }
        let own = block
            .patterns
            .iter()
            .any(|p| is_concrete(p) && p.eq_ignore_ascii_case(name));
        for opt in &block.options {
            match opt.key.as_str() {
                "hostname" => set_once(&mut entry.host_name, &opt.value),
                "user" => set_once(&mut entry.user, &opt.value),
                "identityfile" => set_once(&mut entry.identity_file, &opt.value),
                "proxyjump" => set_once(&mut entry.proxy_jump, &opt.value),
                "port" => {
                    if entry.port.is_none() {
                        entry.port = opt.value.parse().ok();
                    }
                }
                "serveraliveinterval" => {
                    if entry.server_alive_interval.is_none() {
                        entry.server_alive_interval = opt.value.parse().ok();
                    }
                }
                "serveralivecountmax" if entry.server_alive_count_max.is_none() => {
                    entry.server_alive_count_max = opt.value.parse().ok();
                }
                "stricthostkeychecking" if strict.is_none() => {
                    strict = StrictHostKeyChecking::parse(&opt.value);
                }
                "userknownhostsfile" if no_store.is_none() => {
                    no_store = Some(opt.value == STORE_NONE);
                }
                "identitiesonly" => {
                    let on = opt.value == "yes";
                    if identities_only.is_none() {
                        identities_only = Some(on);
                    }
                    if own && identities_only_own.is_none() {
                        identities_only_own = Some(on);
                    }
                }
                "forwardagent" if forward_agent.is_none() => {
                    forward_agent = Some(opt.value == "yes");
                }
                _ => {}
            }
        }
    }

    entry.strict_host_key_checking = strict.unwrap_or_default();
    entry.no_host_key_store = no_store.unwrap_or(false);
    entry.identities_only = identities_only.unwrap_or(false);
    entry.identities_only_own = identities_only_own.unwrap_or(false);
    entry.forward_agent = forward_agent.unwrap_or(false);
    entry
}

fn set_once(slot: &mut Option<String>, value: &str) {
    if slot.is_none() {
        *slot = Some(value.to_string());
    }
}

fn split_line(raw: &str) -> Option<(String, String)> {
    let line = raw.trim();
    if line.is_empty() || line.starts_with('#') {
        return None;
    }
    let end = line
        .find(|c: char| c.is_whitespace() || c == '=')
        .unwrap_or(line.len());
    let key = &line[..end];
    if key.is_empty() {
        return None;
    }
    let mut rest = line[end..].trim_start();
    if let Some(stripped) = rest.strip_prefix('=') {
        rest = stripped.trim_start();
    }
    Some((key.to_string(), rest.to_string()))
}

fn tokenize(s: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut quoted = false;
    let mut started = false;

    for c in s.chars() {
        if c == '"' {
            quoted = !quoted;
            started = true;
        } else if !quoted && c.is_whitespace() {
            if started {
                out.push(std::mem::take(&mut cur));
                started = false;
            }
        } else {
            cur.push(c);
            started = true;
        }
    }
    if started {
        out.push(cur);
    }
    out
}

fn first_value(s: &str) -> Option<String> {
    tokenize(s).into_iter().next().filter(|v| !v.is_empty())
}

fn is_concrete(pattern: &str) -> bool {
    !pattern.is_empty()
        && !pattern.starts_with('!')
        && !pattern.contains('*')
        && !pattern.contains('?')
}

fn matches_pattern(pattern: &str, name: &str) -> bool {
    let p: Vec<char> = pattern.to_lowercase().chars().collect();
    let s: Vec<char> = name.to_lowercase().chars().collect();

    let (mut pi, mut si) = (0usize, 0usize);
    let mut star: Option<usize> = None;
    let mut backtrack = 0usize;

    while si < s.len() {
        if pi < p.len() && (p[pi] == '?' || p[pi] == s[si]) {
            pi += 1;
            si += 1;
        } else if pi < p.len() && p[pi] == '*' {
            star = Some(pi);
            backtrack = si;
            pi += 1;
        } else if let Some(sp) = star {
            pi = sp + 1;
            backtrack += 1;
            si = backtrack;
        } else {
            return false;
        }
    }
    while pi < p.len() && p[pi] == '*' {
        pi += 1;
    }
    pi == p.len()
}

pub fn load_default() -> Result<SshConfig, String> {
    let Some(home) = dirs::home_dir() else {
        return Err(
            tr!(ko: "홈 디렉터리를 찾을 수 없습니다", en: "Could not find the home folder"),
        );
    };
    let path = home.join(".ssh").join("config");

    match std::fs::read_to_string(&path) {
        Ok(content) => Ok(parse(&content)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(SshConfig::default()),
        Err(e) => Err(
            tr!(ko: "{path} 읽기 실패: {e}", en: "Could not read {path}: {e}", path = path.display()),
        ),
    }
}

/// 별칭(소문자) → 그 별칭으로 붙을 계정(못 정하면 `None`).
pub(crate) type ConfigIndex = std::collections::HashMap<String, Option<String>>;

/// 접속이 보는 로더([`load_default`])를 지나야 "붙을 수 있는 별칭" 과 "설정에 있는 별칭" 이 같은 글자를 뜻한다.
/// `User` 가 없으면 `USERNAME` — `resolve_params` 의 `fallback_user` 와 같은 값이어야 한다.
/// 못 읽으면 `None` — 없는 파일(빈 설정)과 다르다. 부르는 쪽은 `None` 을 "전부 있다" 로 읽는다(위임을 고아로 칠하지 않게).
pub(crate) fn config_index() -> Option<ConfigIndex> {
    let fallback = std::env::var("USERNAME").ok().filter(|u| !u.is_empty());
    load_default().ok().map(|c| {
        c.hosts
            .iter()
            .map(|h| {
                let user = h
                    .user
                    .clone()
                    .filter(|u| !u.is_empty())
                    .or_else(|| fallback.clone());
                (h.name.to_lowercase(), user)
            })
            .collect()
    })
}

fn attach_meta(cfg: &mut SshConfig, meta: &SessionsMeta) {
    for host in &mut cfg.hosts {
        host.meta = meta.resolve(&host.name);
    }
}

#[tauri::command]
pub async fn list_hosts() -> Result<SshConfig, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let mut cfg = load_default()?;
        // 메타데이터는 접속에 필요한 값이 아니다 — 읽기에 실패해도 목록은 그대로 내려간다.
        let (meta, warnings) = SessionsMeta::load_default();
        attach_meta(&mut cfg, &meta);
        cfg.warnings.extend(warnings);
        Ok(cfg)
    })
    .await
    .map_err(|e| {
        tr!(
            ko: "호스트 목록을 읽는 작업이 실패했습니다: {e}",
            en: "The task that reads the host list failed: {e}"
        )
    })?
}

#[cfg(test)]
mod tests;
