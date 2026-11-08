//! `~/.ssh/config` 파서. OpenSSH 의 "먼저 얻은 값이 이긴다(first-obtained-value-wins)"
//! 의미론을 따르며, 설계안에서 확정한 최소 옵션 집합만 해석한다.
//! 지원하지 않는 지시어(Include/Match/부정 패턴)는 조용히 버리지 않고 `warnings` 로 올려 보낸다.
//!
//! **읽기만 한다** — `~/.ssh/config` 는 사용자 소유(ssh·scp·git·VS Code 가 함께 읽는다)라 쓰기는
//! `crate::config_edit` 의 국소 패치뿐이다. 화면용 메타(색·그룹·태그)는 `crate::sessions_meta`
//! (docs/log/2026-08-31-ssh-config-parser.md).

use crate::i18n::tr;
use crate::sessions_meta::{HostMeta, SessionsMeta};

/// `StrictHostKeyChecking` 의 네 값. OpenSSH 의 철자를 그대로 직렬화한다
/// (`"yes"` · `"no"` · `"accept-new"` · `"ask"`).
///
/// **보안 원칙**: 이 옵션이 뜻하는 완화는 **사용자가 자기 `~/.ssh/config` 에 그 호스트
/// 블록에 직접 적었을 때만** 생긴다. 옵션이 없으면 언제나 [`StrictHostKeyChecking::Yes`] —
/// 앱의 기본값은 항상 "검증한다" 이며, 앱이 스스로 완화하는 경로는 없다.
///
/// `Ask` 를 `Yes` 와 별도 값으로 남겨 둔 이유: 우리 TOFU 모달이 곧 OpenSSH 의 `ask` 라
/// **동작은 같지만**, 사용자가 config 에 무엇을 적었는지는 그대로 보여줘야 한다
/// (프런트 계약에 실려 나간다 — 지금은 소비하지 않는다).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum StrictHostKeyChecking {
    /// 기본값. 모르는 키는 모달로 물어보고(TOFU), 바뀐 키는 거부한다.
    #[default]
    Yes,
    /// 검증하지 않는다 — known_hosts 를 보지도, 쓰지도 않는다.
    No,
    /// 처음 보는 키는 묻지 않고 받아들인다. **바뀐 키는 여전히 거부**한다.
    AcceptNew,
    /// OpenSSH 의 `ask`. 우리 TOFU 모달이 정확히 이 동작이라 `Yes` 와 같게 취급한다.
    Ask,
}

impl StrictHostKeyChecking {
    /// config 값 문자열 해석. 모르는 값은 `None` (호출부가 경고 후 `Yes` 로 되돌린다).
    fn parse(value: &str) -> Option<Self> {
        match value.to_ascii_lowercase().as_str() {
            "yes" => Some(StrictHostKeyChecking::Yes),
            "no" => Some(StrictHostKeyChecking::No),
            "accept-new" => Some(StrictHostKeyChecking::AcceptNew),
            "ask" => Some(StrictHostKeyChecking::Ask),
            _ => None,
        }
    }

    /// 호스트 키 검증을 통째로 건너뛰는가 (`no`).
    pub fn skips_verification(self) -> bool {
        matches!(self, StrictHostKeyChecking::No)
    }

    /// 처음 보는 키를 **모달 없이** 받아들이는가 (`accept-new`).
    /// 바뀐 키(Changed)는 이 값으로도 뚫리지 않는다.
    pub fn auto_accepts_new(self) -> bool {
        matches!(self, StrictHostKeyChecking::AcceptNew)
    }
}

/// `UserKnownHostsFile` 값이 "아무 데도 기록하지 말라" 는 뜻인지.
/// OpenSSH 관용구인 `/dev/null` 과 `none` 만 인정한다 (대소문자 무시).
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
    /// `IdentitiesOnly yes` — **적힌 키만 낸다**(에이전트 키도, `~/.ssh` 기본 이름도 빼고).
    /// 적히지 않았으면 `false` = OpenSSH 기본값(가진 것을 차례로 내 본다).
    ///
    /// `IdentityFile` 을 **하나도 적지 않은** 호스트에서는 이 값이 켜져 있어도 기본 이름은
    /// 그대로 쓴다 — OpenSSH 도 그렇다(이 옵션이 빼는 것은 **에이전트 키**다).
    /// 그 갈래를 실제로 구현하는 자리는 `ssh::identity_candidates` 하나뿐이다.
    pub identities_only: bool,
    /// **이 호스트의 블록에 실제로 적힌** `IdentitiesOnly` 값 (`Host *` 같은 패턴 블록은 빼고).
    ///
    /// [`HostEntry::identities_only`] 와 갈리는 이유는 **호스트 폼**이다: 폼의 스위치는 저장할
    /// 때 이 블록에 적힐 값이라, 병합값으로 채우면 `Host *` 에서 물려받았을 뿐인 값이 저장
    /// 순간 이 블록에 굳어 상속이 끊긴다 (메타데이터에서 `get_host_meta` 가 원본을 따로 주는
    /// 것과 같은 판단). 접속은 언제나 병합값([`HostEntry::identities_only`])을 본다.
    pub identities_only_own: bool,
    /// `ForwardAgent yes` — **병합값**이다 (`Host *` 까지 합친 first-wins). 적히지 않았으면
    /// `false` = OpenSSH 기본값.
    ///
    /// 접속이 실제로 보는 값은 이것과 `sessions.toml` 의 `forward_agent`(있으면 이긴다)를
    /// 합친 것이다 — [`crate::agent_forward::effective`]. 이 칸은 호스트 폼이 "config 에
    /// 이렇게 적혀 있다" 를 보여 주는 데도 쓴다 (docs/log/2026-09-23-agent-forwarding.md).
    pub forward_agent: bool,
    pub proxy_jump: Option<String>,
    pub server_alive_interval: Option<u32>,
    pub server_alive_count_max: Option<u32>,
    /// `StrictHostKeyChecking`. 적히지 않았으면 `Yes` (= 항상 검증).
    pub strict_host_key_checking: StrictHostKeyChecking,
    /// `UserKnownHostsFile /dev/null` (또는 `none`) — 수락한 키를 **기록하지 않는다**.
    /// 임의 경로는 지원하지 않는다 (경고 후 기본 파일 사용).
    pub no_host_key_store: bool,
    /// `~/.ssh/sessions.toml` 에서 온 표시용 메타데이터 (색·그룹·태그).
    /// 계약을 눈에 보이게 두려고 **flatten 하지 않고 중첩 필드**로 내보낸다 (`host.meta.color`).
    /// `parse()` 만 부르면 비어 있다 — 채우는 곳은 `list_hosts` 하나뿐이다.
    pub meta: HostMeta,
}

#[derive(Debug, Clone, Default, serde::Serialize)]
pub struct SshConfig {
    pub hosts: Vec<HostEntry>,
    pub warnings: Vec<String>,
}

/// 해석 대상 옵션 하나. `key` 는 항상 소문자로 정규화해 둔다.
struct Opt {
    key: String,
    value: String,
}

/// `Host` 줄 하나가 여는 블록. 파일 선두의 옵션들은 패턴 `*` 인 전역 블록에 들어간다.
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

/// [`normalize`] 가 `userknownhostsfile` 을 접는 두 값. 해석 단계는 이 둘만 본다.
const STORE_NONE: &str = "none";
const STORE_DEFAULT: &str = "default";

pub fn parse(content: &str) -> SshConfig {
    let mut warnings: Vec<String> = Vec::new();

    // 0번은 첫 Host 앞의 옵션을 담는 전역 블록 (OpenSSH 와 동일하게 모든 호스트에 적용).
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
                        break; // 줄 끝 주석
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
                    // 뒤따르는 옵션이 이전 블록에 섞이지 않도록 Match 와 동일하게 버린다.
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
                    continue; // 우리가 모델링하지 않는 옵션은 조용히 통과 (유효한 ssh 설정일 수 있다).
                }
                let Some(value) = first_value(&rest) else {
                    warnings.push(tr!(
                        ko: "line {line}: {key} 에 값이 없습니다 — 무시합니다",
                        en: "line {line}: {key} has no value — it is ignored"
                    ));
                    continue;
                };
                // 값 검증은 여기서 한 번만 한다 (해석 단계에서 하면 호스트 수만큼 경고가 중복된다).
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

    // 목록에 내보낼 이름은 와일드카드가 없는 구체 별칭뿐. 등장 순서를 유지한다.
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

/// 옵션 값 하나를 검증·정규화한다. `None` 이면 그 줄은 버려진다 (다음 값이 first-wins 를 이어받는다).
///
/// 보안 옵션은 **버리지 않는다**. 사용자가 뭔가 적었다는 사실 자체가 first-wins 슬롯을
/// 차지해야 뒤따르는 `Host *` 블록의 완화 값이 슬쩍 이기지 못한다. 그래서 알 수 없는
/// `StrictHostKeyChecking` 값은 경고와 함께 **`yes` 로 접어** 넣고, 지원하지 않는
/// `UserKnownHostsFile` 경로는 "기본 파일을 쓴다" 는 값으로 접어 넣는다.
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
        // `yes`/`no` 둘뿐이다. 알 수 없는 값은 **버린다** (`Port abc` 와 같은 처방):
        // 이 옵션에는 "완화" 방향이 없어서, 슬롯을 비워 둬도 보안이 새지 않는다
        // (`Host *` 가 이기면 후보가 **줄어들 뿐**이다).
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
        // `yes`/`no` 만 받는다. OpenSSH 는 소켓 경로·`$환경변수` 도 받지만(다른 에이전트로
        // 포워딩) 이 앱의 중계는 언제나 **이 PC 의 기본 에이전트** 하나라, 그 값을 `yes` 로
        // 접으면 사용자가 적은 것과 다른 에이전트가 서명한다. 모르는 값은 버린다 — 버리면
        // 꺼지는 쪽이라 새는 것이 없다.
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

/// 이름 하나에 매치되는 모든 블록을 위에서부터 훑어 first-wins 로 병합한다.
fn resolve(name: &str, blocks: &[Block]) -> HostEntry {
    let mut entry = HostEntry {
        name: name.to_string(),
        ..HostEntry::default()
    };
    // 값 자체가 Option 이 아닌 두 옵션은 "아직 안 정해짐" 을 여기서 따로 들고 있어야
    // first-wins 가 성립한다 (기본값과 사용자가 적은 값을 구분할 자리가 필요하다).
    let mut strict: Option<StrictHostKeyChecking> = None;
    let mut no_store: Option<bool> = None;
    let mut identities_only: Option<bool> = None;
    // 같은 옵션의 **자기 블록만** 본 값 — 폼이 채우는 값이다 (필드 주석 참고).
    let mut identities_only_own: Option<bool> = None;
    let mut forward_agent: Option<bool> = None;

    for block in blocks {
        if !block.patterns.iter().any(|p| matches_pattern(p, name)) {
            continue;
        }
        // "자기 블록" = `Host` 줄에 이 별칭이 **글자 그대로** 적힌 블록 (패턴이 아니라).
        // 여러 별칭을 공유하는 줄(`Host web db`)도 둘 다의 자기 블록이다.
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
                    // normalize 가 이미 네 값 중 하나로 접어 두었다.
                    strict = StrictHostKeyChecking::parse(&opt.value);
                }
                "userknownhostsfile" if no_store.is_none() => {
                    no_store = Some(opt.value == STORE_NONE);
                }
                "identitiesonly" => {
                    // normalize 가 이미 "yes"/"no" 둘 중 하나로 접어 두었다.
                    let on = opt.value == "yes";
                    if identities_only.is_none() {
                        identities_only = Some(on);
                    }
                    if own && identities_only_own.is_none() {
                        identities_only_own = Some(on);
                    }
                }
                // normalize 가 이미 "yes"/"no" 로 접어 두었다.
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

/// 한 줄을 (키워드, 나머지) 로 쪼갠다. 주석/빈 줄은 None.
/// `Key Value`, `Key=Value`, `Key = Value` 를 모두 받아들인다 (OpenSSH 와 동일).
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

/// 공백 구분 토큰화. `"..."` 안의 공백은 보존한다.
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

/// 옵션 값은 첫 토큰만 쓴다 (뒤에 붙은 주석 등은 버려진다).
fn first_value(s: &str) -> Option<String> {
    tokenize(s).into_iter().next().filter(|v| !v.is_empty())
}

fn is_concrete(pattern: &str) -> bool {
    !pattern.is_empty()
        && !pattern.starts_with('!')
        && !pattern.contains('*')
        && !pattern.contains('?')
}

/// `*`(0자 이상) 와 `?`(정확히 1자) 만 지원하는 글롭. OpenSSH 처럼 대소문자를 무시한다.
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
        // 설정 파일이 없는 것은 오류가 아니다 — 빈 목록으로 본다.
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(SshConfig::default()),
        Err(e) => Err(
            tr!(ko: "{path} 읽기 실패: {e}", en: "Could not read {path}: {e}", path = path.display()),
        ),
    }
}

/// `~/.ssh/config` 색인 — **별칭(소문자) → 그 별칭으로 붙을 계정**(못 정하면 `None`).
///
/// 두 물음이 이 하나에서 나온다: **있는가**(키 존재)와 **누구로 붙는가**(값). 집합과 표를
/// 따로 두면 같은 파일을 두 번 읽거나 두 값이 어긋난다. 지금 읽는 자리가 둘이다 —
/// [`crate::mcp::sessions::enrich_sessions`](세션 목록의 `user`·`aliasKnown`)와
/// `delegation_list_targets`(위임 줄의 고아 판정). 그래서 **파서가 아니라 색인**이 공용이다.
pub(crate) type ConfigIndex = std::collections::HashMap<String, Option<String>>;

/// `~/.ssh/config` 를 읽어 [`ConfigIndex`] 를 만든다.
///
/// 파서를 새로 만들지 않는다: `connect_delegated`/`resolve_params` 가 보는 바로 그 로더
/// ([`load_default`])를 지난다 — 그래야 "붙을 수 있는 별칭" 과 "설정에 있는 별칭" 이 같은
/// 글자를 뜻한다. 블록에 `User` 가 없으면 `USERNAME` 으로 떨어진다(`resolve_params` 의
/// `fallback_user` 와 같은 값).
///
/// **못 읽으면 `None`** — 파일이 없는 것과 읽기가 실패한 것은 다르다. 없는 파일은
/// `Ok(빈 설정)` 이라 "정말 고아" 이고, 읽기 실패는 우리가 모르는 상태라 위임을 통째로
/// "설정에 없음" 으로 칠할 근거가 못 된다(부르는 쪽이 `None` 을 "전부 있다" 로 읽는다).
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

/// 파싱된 호스트 목록에 `~/.ssh/sessions.toml` 메타데이터를 얹는다.
/// sessions.toml 쪽 경고는 같은 `warnings` 목록에 이어 붙어 사이드바에 함께 보인다.
fn attach_meta(cfg: &mut SshConfig, meta: &SessionsMeta) {
    for host in &mut cfg.hosts {
        host.meta = meta.resolve(&host.name);
    }
}

/// 사이드바가 그리는 호스트 목록. `~/.ssh/config` 와 `~/.ssh/sessions.toml` **두 파일**을
/// 읽고 `Include` 를 따라가므로 파일 여러 개를 만질 수 있다.
///
/// **블로킹 풀에서 돈다.** 사이드바는 앱을 켤 때와 호스트를 고칠 때마다 이걸 다시 부르는데,
/// 그 시점은 대개 터미널들이 이미 출력을 뱉고 있는 중이다. 동기 명령이 웹뷰 UI 스레드를
/// 잡으면 그 출력 채널이 통째로 막힌다 (docs/log/2026-09-05-async-commands.md).
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
