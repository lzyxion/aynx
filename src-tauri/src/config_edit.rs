//! `~/.ssh/config` 편집 진입점 — 호스트 추가 · 수정 · 삭제 · 설정 파일 열기.
//!
//! 이 파일은 앱의 소유물이 아니다(`ssh` · `git` · VS Code Remote-SSH 가 읽고 사람이 손으로 쓴 줄이 있다). 파서([`crate::ssh_config`])는
//! 일부만 모델링하므로 전체 재작성은 하지 않는다 — 모르는 줄이 조용히 사라진다.
//! - 추가는 파일 끝에 새 `Host` 블록을 붙이기만 한다([`add_host_at`]). 기존 바이트는 건드리지 않는다.
//! - 수정 · 삭제는 대상 `Host` 블록 구간만 바꾸고, 수정은 블록 안에서도 모델링한 옵션 줄만 손댄다. 예외 하나: 별칭을 바꾸면 다른 블록
//!   `ProxyJump` 의 별칭 자리만 새 이름으로 따라간다([`retarget_jump_line`]).

use std::io::Write;
use std::path::{Path, PathBuf};

use tauri_plugin_opener::OpenerExt;

use crate::i18n::tr;

#[derive(Debug, serde::Deserialize)]
pub struct NewHost {
    pub name: String,
    pub host_name: String,
    pub user: Option<String>,
    pub port: Option<u16>,
    pub identity_file: Option<String>,
    #[serde(default)]
    pub identities_only: Option<bool>,
    pub proxy_jump: Option<String>,
}

/// `original_name` 은 블록을 찾는 열쇠, `name` 은 저장할(바뀔 수도 있는) 새 별칭이다.
#[derive(Debug, serde::Deserialize)]
pub struct EditHost {
    pub original_name: String,
    pub name: String,
    pub host_name: String,
    pub user: Option<String>,
    pub port: Option<u16>,
    pub identity_file: Option<String>,
    #[serde(default)]
    pub identities_only: Option<bool>,
    pub proxy_jump: Option<String>,
}

impl EditHost {
    fn as_new(&self) -> NewHost {
        NewHost {
            name: self.name.clone(),
            host_name: self.host_name.clone(),
            user: self.user.clone(),
            port: self.port,
            identity_file: self.identity_file.clone(),
            identities_only: self.identities_only,
            proxy_jump: self.proxy_jump.clone(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ValidHost {
    name: String,
    host_name: String,
    user: Option<String>,
    port: Option<u16>,
    identity_file: Option<String>,
    identities_only: bool,
    proxy_jump: Option<String>,
}

// ---------------------------------------------------------------------------
// 검증 (순수)
// ---------------------------------------------------------------------------

fn clean(v: Option<&String>) -> Option<String> {
    v.map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

/// 한 줄 값의 금지 문자 — 제어 문자 · 개행(블록 구조가 깨진다) · `"`(파서 토큰화가 어긋난다) · `#`(뒤가 주석으로 잘린다).
fn reject_unsafe_chars(label: &str, value: &str) -> Result<(), String> {
    if value.chars().any(char::is_control) {
        return Err(tr!(
            ko: "{label}에 제어 문자를 쓸 수 없습니다",
            en: "{label} cannot contain control characters",
            label = label,
        ));
    }
    if value.contains('"') || value.contains('#') {
        return Err(tr!(
            ko: "{label}에 따옴표(\")나 # 을 쓸 수 없습니다",
            en: "{label} cannot contain a quote (\") or #",
            label = label,
        ));
    }
    Ok(())
}

/// 와일드카드는 패턴 블록이라 목록에 뜨지 않고, `=` 는 OpenSSH 가 `Host=name` 의 구분자로 읽는다.
pub(crate) fn validate_alias(name: &str) -> Result<String, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err(tr!(ko: "별칭을 입력하세요", en: "Enter an alias"));
    }
    if name.chars().any(char::is_whitespace) {
        return Err(tr!(
            ko: "별칭에 공백을 쓸 수 없습니다",
            en: "The alias cannot contain spaces"
        ));
    }
    if name.contains('*') || name.contains('?') || name.contains('!') {
        return Err(tr!(
            ko: "별칭에 와일드카드(*, ?)나 부정(!)을 쓸 수 없습니다",
            en: "The alias cannot contain wildcards (*, ?) or a negation (!)"
        ));
    }
    if name.contains('=') {
        return Err(tr!(
            ko: "별칭에 = 를 쓸 수 없습니다",
            en: "The alias cannot contain ="
        ));
    }
    reject_unsafe_chars(&tr!(ko: "별칭", en: "The alias"), name)?;
    Ok(name.to_string())
}

pub(crate) fn validate(host: &NewHost) -> Result<ValidHost, String> {
    let name = validate_alias(&host.name)?;

    let host_name = host.host_name.trim();
    if host_name.is_empty() {
        return Err(tr!(ko: "호스트 주소를 입력하세요", en: "Enter a host address"));
    }
    if host_name.chars().any(char::is_whitespace) {
        return Err(tr!(
            ko: "호스트 주소에 공백을 쓸 수 없습니다",
            en: "The host address cannot contain spaces"
        ));
    }
    reject_unsafe_chars(&tr!(ko: "호스트 주소", en: "The host address"), host_name)?;

    let user = clean(host.user.as_ref());
    if let Some(u) = &user {
        if u.chars().any(char::is_whitespace) {
            return Err(tr!(
                ko: "사용자 이름에 공백을 쓸 수 없습니다",
                en: "The user name cannot contain spaces"
            ));
        }
        reject_unsafe_chars(&tr!(ko: "사용자 이름", en: "The user name"), u)?;
    }

    if host.port == Some(0) {
        return Err(tr!(
            ko: "포트는 1 이상이어야 합니다",
            en: "The port must be 1 or greater"
        ));
    }

    // IdentityFile 은 경로라 공백이 들어갈 수 있다 — 막지 않고 출력 때 따옴표로 감싼다.
    let identity_file = clean(host.identity_file.as_ref());
    if let Some(p) = &identity_file {
        reject_unsafe_chars(
            &tr!(ko: "IdentityFile 경로", en: "The IdentityFile path"),
            p,
        )?;
    }

    // `ssh.rs` 가 실제로 열 수 있는 것과 같아야 한다 — 한 단계만(쉼표 거절) · 자기 자신 금지 · 한 줄 값 금지 문자.
    let proxy_jump = clean(host.proxy_jump.as_ref());
    if let Some(j) = &proxy_jump {
        if j.chars().any(char::is_whitespace) {
            return Err(tr!(
                ko: "경유 호스트에 공백을 쓸 수 없습니다",
                en: "The jump host cannot contain spaces"
            ));
        }
        reject_unsafe_chars(&tr!(ko: "경유 호스트", en: "The jump host"), j)?;
        if j.contains(',') {
            return Err(crate::ssh::multi_jump());
        }
        if j.eq_ignore_ascii_case(&name) {
            return Err(tr!(
                ko: "경유 호스트가 자기 자신('{name}')을 가리킵니다",
                en: "The jump host points at itself ('{name}')",
                name = name,
            ));
        }
    }

    Ok(ValidHost {
        name,
        host_name: host_name.to_string(),
        user,
        port: host.port,
        identity_file,
        // 키 파일 없이 켜도 오류가 아니다(OpenSSH 는 기본 이름을 그대로 쓰고 에이전트만 뺀다).
        identities_only: host.identities_only.unwrap_or(false),
        proxy_jump,
    })
}

// ---------------------------------------------------------------------------
// 포매팅 (순수)
// ---------------------------------------------------------------------------

fn quote_if_needed(value: &str) -> String {
    if value.chars().any(char::is_whitespace) {
        format!("\"{value}\"")
    } else {
        value.to_string()
    }
}

pub(crate) fn format_block(host: &ValidHost) -> String {
    let mut out = format!("Host {}\n", quote_if_needed(&host.name));
    out.push_str(&format!("    HostName {}\n", host.host_name));
    if let Some(user) = &host.user {
        out.push_str(&format!("    User {user}\n"));
    }
    if let Some(port) = host.port {
        out.push_str(&format!("    Port {port}\n"));
    }
    if let Some(path) = &host.identity_file {
        out.push_str(&format!("    IdentityFile {}\n", quote_if_needed(path)));
    }
    if host.identities_only {
        out.push_str("    IdentitiesOnly yes\n");
    }
    if let Some(jump) = &host.proxy_jump {
        out.push_str(&format!("    ProxyJump {jump}\n"));
    }
    out
}

/// 기존 내용 뒤에 덧붙일 텍스트(기존 내용은 들지 않는다). 이미 빈 줄로 끝나면 더 띄우지 않는다 — 부를 때마다 빈 줄이 쌓이지 않게.
pub(crate) fn append_text(existing: &str, host: &ValidHost) -> String {
    format!("{}{}", append_prefix(existing), format_block(host))
}

fn append_prefix(existing: &str) -> &'static str {
    if existing.is_empty() {
        ""
    } else if !existing.ends_with('\n') {
        "\n\n"
    } else if existing.ends_with("\n\n") || existing.ends_with("\n\r\n") {
        ""
    } else {
        "\n"
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct HostBlockText {
    pub names: Vec<String>,
    /// 다음 `Host`/`Match` 줄 직전까지 — 뒤 빈 줄은 걷고 개행으로 끝난다.
    pub text: String,
}

/// 구체 별칭만 적힌 `Host` 블록의 원문. 패턴이 섞인 블록 · `Match` 블록 · 첫 `Host` 앞 머리글은 담지 않는다 — 여러 호스트에
/// 걸리는 사람의 규칙이라 다른 PC 의 파일에 옮겨 적을 대상이 아니다.
pub(crate) fn concrete_host_blocks(content: &str) -> Vec<HostBlockText> {
    let lines = split_lines_keep(content);
    let mut starts: Vec<(usize, bool)> = Vec::new(); // (줄 번호, Host 인가 — 아니면 Match)
    for (i, raw) in lines.iter().enumerate() {
        if let Some(d) = parse_directive(raw) {
            if d.keyword.eq_ignore_ascii_case("host") {
                starts.push((i, true));
            } else if d.keyword.eq_ignore_ascii_case("match") {
                starts.push((i, false));
            }
        }
    }
    let mut out = Vec::new();
    for (n, &(start, is_host)) in starts.iter().enumerate() {
        if !is_host {
            continue;
        }
        let end = starts.get(n + 1).map_or(lines.len(), |&(e, _)| e);
        let Some(d) = parse_directive(lines[start]) else { continue };
        let names: Vec<String> = host_patterns(d.value).into_iter().map(|(_, _, t)| t).collect();
        if names.is_empty() || names.iter().any(|n| n.is_empty() || n.contains(['*', '?', '!'])) {
            continue;
        }
        let mut body: String = lines[start..end].concat();
        let trimmed = body.trim_end().len();
        body.truncate(trimmed);
        body.push('\n');
        out.push(HostBlockText { names, text: body });
    }
    out
}

pub(crate) fn append_blocks_text(existing: &str, blocks: &[&str]) -> String {
    if blocks.is_empty() {
        return String::new();
    }
    let joined: Vec<String> =
        blocks.iter().map(|b| if b.ends_with('\n') { (*b).to_string() } else { format!("{b}\n") }).collect();
    format!("{}{}", append_prefix(existing), joined.join("\n"))
}

// ---------------------------------------------------------------------------
// 국소 블록 패치 (순수)
//
// 파일을 줄 목록으로 본다 — 각 줄이 자기 개행을 달고 있어 손대지 않은 줄을 이어 붙이면 원본 바이트가 그대로다.
// ---------------------------------------------------------------------------

/// 새로 추가할 때의 출력 순서도 이 순서다.
const EDITABLE: [&str; 6] = [
    "hostname",
    "user",
    "port",
    "identityfile",
    "identitiesonly",
    "proxyjump",
];

fn split_lines_keep(content: &str) -> Vec<&str> {
    let mut out = Vec::new();
    let mut start = 0;
    for (i, c) in content.char_indices() {
        if c == '\n' {
            out.push(&content[start..=i]);
            start = i + 1;
        }
    }
    if start < content.len() {
        out.push(&content[start..]);
    }
    out
}

/// `indent + keyword + sep + value + newline` 을 그대로 이으면 원래 줄이 된다.
struct Directive<'a> {
    indent: &'a str,
    keyword: &'a str,
    /// `" "` · `"="` · `" = "` 를 원문 그대로.
    sep: &'a str,
    /// 줄 끝 주석 · 뒤 공백까지 포함.
    value: &'a str,
    newline: &'a str,
}

fn parse_directive(raw: &str) -> Option<Directive<'_>> {
    let (body, newline) = match raw.strip_suffix('\n') {
        Some(b) => match b.strip_suffix('\r') {
            Some(b2) => (b2, &raw[raw.len() - 2..]),
            None => (b, &raw[raw.len() - 1..]),
        },
        None => (raw, ""),
    };

    let indent_len = body.len() - body.trim_start().len();
    let (indent, rest) = body.split_at(indent_len);
    if rest.is_empty() || rest.starts_with('#') {
        return None;
    }

    let key_end = rest
        .find(|c: char| c.is_whitespace() || c == '=')
        .unwrap_or(rest.len());
    if key_end == 0 {
        return None;
    }
    let (keyword, after) = rest.split_at(key_end);

    let sep_end = after
        .find(|c: char| !(c.is_whitespace() || c == '='))
        .unwrap_or(after.len());
    let (sep, value) = after.split_at(sep_end);

    Some(Directive {
        indent,
        keyword,
        sep,
        value,
        newline,
    })
}

/// 파서([`crate::ssh_config`])의 `tokenize` 와 같은 규칙이되 위치를 함께 준다.
fn token_spans(value: &str) -> Vec<(usize, usize, String)> {
    let mut out = Vec::new();
    let mut it = value.char_indices().peekable();

    while let Some(&(start, c)) = it.peek() {
        if c.is_whitespace() {
            it.next();
            continue;
        }
        let mut text = String::new();
        let mut end = value.len();
        let mut quoted = false;
        for (i, ch) in it.by_ref() {
            if ch == '"' {
                quoted = !quoted;
            } else if !quoted && ch.is_whitespace() {
                end = i;
                break;
            } else {
                text.push(ch);
            }
        }
        out.push((start, end, text));
    }
    out
}

fn host_patterns(value: &str) -> Vec<(usize, usize, String)> {
    let mut out = Vec::new();
    for span in token_spans(value) {
        if span.2.starts_with('#') {
            break;
        }
        out.push(span);
    }
    out
}

/// 들여쓰기 · 구분자 · 줄 끝 주석은 그대로 둔다.
fn replace_first_value(d: &Directive<'_>, replacement: &str) -> String {
    let rest = match token_spans(d.value).first() {
        Some(&(_, end, _)) => &d.value[end..],
        None => d.value,
    };
    // 값이 없던 줄(`Port` 한 낱말)은 구분자도 없다 — 값을 붙이려면 공백 하나를 세워 준다.
    let sep = if d.sep.is_empty() { " " } else { d.sep };
    format!(
        "{}{}{sep}{replacement}{rest}{}",
        d.indent, d.keyword, d.newline
    )
}

// ---------------------------------------------------------------------------
// 다른 블록의 `ProxyJump`
//
// 별칭을 바꾸고 말면 다른 블록의 `ProxyJump` 가 없는 이름을 가리켜 그 호스트들이 경유 단계에서 실패한다 — 같은 파일 안이라 여기서
// 따라간다(앱 쪽 자리는 프런트 — docs/log/2026-09-17-host-rename-fanout.md). 판정은 별칭 자리의 글자째 일치다.
// 대소문자는 접지 않는다 — OpenSSH 호스트 매칭이 대소문자를 무시해 옛 글자도 깨지지 않고, 파일을 덜 건드린다.
// ---------------------------------------------------------------------------

/// `[user@]호스트[:포트]` 의 호스트 자리 `(시작, 끝)`. 마지막 `:` 뒤가 전부 숫자일 때만 포트로 본다(`[::1]` 을 반으로 자르지 않게).
fn hop_alias_span(hop: &str) -> (usize, usize) {
    let start = match hop.rfind('@') {
        Some(i) => i + 1,
        None => 0,
    };
    let rest = &hop[start..];
    let end = match rest.rfind(':') {
        Some(i) if i + 1 < rest.len() && rest[i + 1..].bytes().all(|b| b.is_ascii_digit()) => {
            start + i
        }
        _ => hop.len(),
    };
    (start, end)
}

/// 이름 바꾸기와 지우기가 같은 한 판정을 쓴다.
fn hop_targets(hop: &str, alias: &str) -> bool {
    let (s, e) = hop_alias_span(hop);
    &hop[s..e] == alias
}

fn retarget_jump_value(value: &str, from: &str, to: &str) -> Option<String> {
    let mut changed = false;
    let mut out = String::with_capacity(value.len());
    for (i, hop) in value.split(',').enumerate() {
        if i > 0 {
            out.push(',');
        }
        if hop_targets(hop, from) {
            changed = true;
            let (s, e) = hop_alias_span(hop);
            out.push_str(&hop[..s]);
            out.push_str(to);
            out.push_str(&hop[e..]);
        } else {
            out.push_str(hop);
        }
    }
    changed.then_some(out)
}

fn retarget_jump_line(raw: &str, from: &str, to: &str) -> Option<String> {
    let d = parse_directive(raw)?;
    if !d.keyword.eq_ignore_ascii_case("proxyjump") {
        return None;
    }
    let (s, e, text) = token_spans(d.value).into_iter().next()?;
    // 따옴표가 섞인 값은 손대지 않는다 — 벗겨서 다시 쓰면 원문 바이트가 달라진다.
    if d.value.get(s..e) != Some(text.as_str()) {
        return None;
    }
    let replaced = retarget_jump_value(&text, from, to)?;
    Some(replace_first_value(&d, &replaced))
}

fn retarget_jumps(lines: &[&str], from: &str, to: &str) -> (String, usize) {
    let mut out = String::new();
    let mut count = 0usize;
    for raw in lines {
        match retarget_jump_line(raw, from, to) {
            Some(line) => {
                out.push_str(&line);
                count += 1;
            }
            None => out.push_str(raw),
        }
    }
    (out, count)
}

/// 줄을 그대로 읽는다 — 파서의 병합값을 쓰면 `Host *` 에서 값을 물려받았을 뿐인 호스트까지 딸려 온다.
fn jump_referrers(lines: &[&str], skip: std::ops::Range<usize>, alias: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut current: Option<String> = None;
    for (i, raw) in lines.iter().enumerate() {
        let Some(d) = parse_directive(raw) else {
            continue;
        };
        if d.keyword.eq_ignore_ascii_case("host") {
            current = host_patterns(d.value).first().map(|(_, _, t)| t.clone());
            continue;
        }
        if d.keyword.eq_ignore_ascii_case("match") {
            current = None; // `Match` 블록은 호스트 이름으로 부를 수 없다
            continue;
        }
        if skip.contains(&i) || !d.keyword.eq_ignore_ascii_case("proxyjump") {
            continue;
        }
        let Some((_, _, text)) = token_spans(d.value).into_iter().next() else {
            continue;
        };
        if !text.split(',').any(|hop| hop_targets(hop, alias)) {
            continue;
        }
        if let Some(name) = &current {
            if !out.iter().any(|n| n == name) {
                out.push(name.clone());
            }
        }
    }
    out
}

/// 번역이 실행 시점에 정해져 상수가 될 수 없다.
fn not_found() -> String {
    tr!(
        ko: "호스트를 찾을 수 없습니다 — 목록을 새로고침하세요",
        en: "Host not found — refresh the list"
    )
}

/// 폼 값이 이 옵션 줄에 무엇을 원하는지. `None` = 줄을 지운다.
fn desired_value(key: &str, host: &ValidHost) -> Option<String> {
    match key {
        "hostname" => Some(host.host_name.clone()),
        "user" => host.user.clone(),
        "port" => host.port.map(|p| p.to_string()),
        "identityfile" => host.identity_file.as_deref().map(quote_if_needed),
        // 꺼짐은 `no` 가 아니라 줄 없음 — `no` 를 남기면 `Host *` 에서 물려받던 값을 여기서 끊는다.
        "identitiesonly" => host.identities_only.then(|| "yes".to_string()),
        // 공백을 막아 둬 따옴표를 씌우지 않는다 — 씌우면 사람이 손으로 적은 줄과 모양이 달라진다.
        "proxyjump" => host.proxy_jump.clone(),
        _ => None,
    }
}

/// `original_name` 의 `Host` 블록만 국소 패치한 파일 전체와 경고. 블록 밖은 바이트 단위로 같고, 블록 안에서도 [`EDITABLE`] 줄과
/// `Host` 줄의 해당 패턴 토큰만 바뀐다. 같은 별칭 블록이 여럿이면 첫 블록만 고치고 경고한다.
pub(crate) fn patch_block(
    content: &str,
    original_name: &str,
    host: &EditHost,
) -> Result<(String, Vec<String>), String> {
    let original = original_name.trim();
    if original.is_empty() {
        return Err(not_found());
    }

    let valid = validate(&host.as_new())?;

    // 판정 기준은 add_host 와 같은 파서다 — 목록에 보이는 이름과 어긋나지 않게.
    if !valid.name.eq_ignore_ascii_case(original)
        && crate::ssh_config::parse(content)
            .hosts
            .iter()
            .any(|h| h.name.eq_ignore_ascii_case(&valid.name))
    {
        return Err(tr!(
            ko: "이미 있는 별칭입니다",
            en: "That alias is already in use"
        ));
    }

    let lines = split_lines_keep(content);

    let mut start = None;
    let mut duplicate_blocks = 0usize;
    for (i, raw) in lines.iter().enumerate() {
        let Some(d) = parse_directive(raw) else {
            continue;
        };
        if !d.keyword.eq_ignore_ascii_case("host") {
            continue;
        }
        if host_patterns(d.value)
            .iter()
            .any(|(_, _, t)| t.eq_ignore_ascii_case(original))
        {
            if start.is_none() {
                start = Some(i);
            } else {
                duplicate_blocks += 1;
            }
        }
    }
    let start = start.ok_or_else(not_found)?;

    let mut end = lines.len();
    for (i, raw) in lines.iter().enumerate().skip(start + 1) {
        if let Some(d) = parse_directive(raw) {
            if d.keyword.eq_ignore_ascii_case("host") || d.keyword.eq_ignore_ascii_case("match") {
                end = i;
                break;
            }
        }
    }

    let mut warnings = Vec::new();
    if duplicate_blocks > 0 {
        warnings.push(tr!(
            ko: "'{original}' 블록이 {count}개 있습니다 — 첫 번째 블록만 수정했습니다. 나머지는 설정 파일을 직접 확인하세요",
            en: "There are {count} '{original}' blocks — only the first was edited. Check the config file directly for the rest",
            count = duplicate_blocks + 1,
        ));
    }

    // 파일에 적힌 옛 글자를 들고 나간다 — 블록 찾기는 대소문자를 무시하지만 `ProxyJump` 따라가기는 글자째 비교한다.
    let mut renamed_from: Option<String> = None;
    let host_line = {
        let d = parse_directive(lines[start]).expect("Host 줄은 지시어다");
        let patterns = host_patterns(d.value);
        if patterns.len() > 1 {
            warnings.push(tr!(
                ko: "이 블록은 패턴 {count}개에 함께 적용됩니다 — 바꾼 값이 다른 호스트에도 반영됩니다",
                en: "This block applies to {count} patterns — the change also affects the other hosts",
                count = patterns.len(),
            ));
        }
        if valid.name == original {
            lines[start].to_string()
        } else {
            let (s, e, old) = patterns
                .iter()
                .find(|(_, _, t)| t.eq_ignore_ascii_case(original))
                .expect("찾은 블록에는 대상 패턴이 있다");
            renamed_from = Some(old.clone());
            format!(
                "{}{}{}{}{}{}{}",
                d.indent,
                d.keyword,
                d.sep,
                &d.value[..*s],
                quote_if_needed(&valid.name),
                &d.value[*e..],
                d.newline
            )
        }
    };

    let mut out: Vec<String> = vec![host_line];
    let mut handled: Vec<&str> = Vec::new();
    let mut indent: Option<String> = None;
    let mut newline: Option<String> = None;

    for raw in &lines[start + 1..end] {
        let Some(d) = parse_directive(raw) else {
            out.push((*raw).to_string());
            continue;
        };
        if indent.is_none() {
            indent = Some(d.indent.to_string());
        }
        if !d.newline.is_empty() {
            newline = Some(d.newline.to_string());
        }

        let key = d.keyword.to_ascii_lowercase();
        let Some(slot) = EDITABLE.iter().find(|k| **k == key) else {
            out.push((*raw).to_string());
            continue;
        };

        // 같은 옵션이 두 번이면 첫 줄만 남긴다 — 뒷줄을 남기면 first-wins 로 우리가 쓴 값이 옛 값에 가려질 수 있다.
        if handled.contains(slot) {
            continue;
        }
        handled.push(*slot);
        match desired_value(&key, &valid) {
            Some(v) => out.push(replace_first_value(&d, &v)),
            None => continue,
        }
    }

    let missing: Vec<&str> = EDITABLE
        .iter()
        .copied()
        .filter(|k| !handled.contains(k) && desired_value(k, &valid).is_some())
        .collect();

    if !missing.is_empty() {
        let indent = indent
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "    ".to_string());
        let file_newline = if content.contains("\r\n") {
            "\r\n"
        } else {
            "\n"
        };
        let newline = newline
            .or_else(|| parse_directive(lines[start]).map(|d| d.newline.to_string()))
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| file_newline.to_string());

        let mut at = out.len();
        while at > 1 && out[at - 1].trim().is_empty() {
            at -= 1;
        }
        if !out[at - 1].ends_with('\n') {
            out[at - 1].push_str(&newline);
        }

        for key in missing.into_iter().rev() {
            let value = desired_value(key, &valid).expect("missing 는 값이 있는 것만 모았다");
            let name = match key {
                "hostname" => "HostName",
                "user" => "User",
                "port" => "Port",
                "identityfile" => "IdentityFile",
                "identitiesonly" => "IdentitiesOnly",
                _ => "ProxyJump",
            };
            out.insert(at, format!("{indent}{name} {value}{newline}"));
        }
    }

    // 이름이 바뀌었으면 블록 밖의 `ProxyJump` 도 따라간다 — 블록 바깥 바이트를 건드리는 유일한 예외다.
    let (head, tail) = match &renamed_from {
        Some(from) => {
            let (head, a) = retarget_jumps(&lines[..start], from, &valid.name);
            let (tail, b) = retarget_jumps(&lines[end..], from, &valid.name);
            if a + b > 0 {
                warnings.push(tr!(
                    ko: "경유 호스트 참조 {count}개를 새 이름으로 고쳤습니다",
                    en: "Updated {count} jump-host reference(s)",
                    count = a + b,
                ));
            }
            (head, tail)
        }
        None => (lines[..start].concat(), lines[end..].concat()),
    };

    let patched = format!("{head}{}{tail}", out.concat());
    Ok((patched, warnings))
}

/// `name` 별칭의 `Host` 블록을 들어낸 파일 전체와 경고. 블록 밖(바로 위에 사람이 적은 주석 · 빈 줄 포함)은 바이트 그대로다.
/// 여러 별칭을 공유하는 `Host` 줄은 블록을 지우지 않고 대상 토큰만 뺀다 — 다른 별칭까지 사라진다. 같은 별칭 블록이 여럿이면 첫 블록만.
pub(crate) fn remove_block(content: &str, name: &str) -> Result<(String, Vec<String>), String> {
    let target = name.trim();
    if target.is_empty() {
        return Err(not_found());
    }

    let lines = split_lines_keep(content);

    let mut start = None;
    let mut duplicate_blocks = 0usize;
    for (i, raw) in lines.iter().enumerate() {
        let Some(d) = parse_directive(raw) else {
            continue;
        };
        if !d.keyword.eq_ignore_ascii_case("host") {
            continue;
        }
        if host_patterns(d.value)
            .iter()
            .any(|(_, _, t)| t.eq_ignore_ascii_case(target))
        {
            if start.is_none() {
                start = Some(i);
            } else {
                duplicate_blocks += 1;
            }
        }
    }
    let start = start.ok_or_else(not_found)?;

    let mut end = lines.len();
    for (i, raw) in lines.iter().enumerate().skip(start + 1) {
        if let Some(d) = parse_directive(raw) {
            if d.keyword.eq_ignore_ascii_case("host") || d.keyword.eq_ignore_ascii_case("match") {
                end = i;
                break;
            }
        }
    }

    let mut warnings = Vec::new();
    if duplicate_blocks > 0 {
        warnings.push(tr!(
            ko: "'{target}' 블록이 {count}개 있습니다 — 첫 번째 블록만 삭제했습니다. 나머지는 설정 파일을 직접 확인하세요",
            en: "There are {count} '{target}' blocks — only the first was deleted. Check the config file directly for the rest",
            count = duplicate_blocks + 1,
        ));
    }

    let d = parse_directive(lines[start]).expect("Host 줄은 지시어다");
    let patterns = host_patterns(d.value);

    // 경유를 잃는 호스트는 무엇으로 바꿀지 사람만 알아 이름을 대 준다. 판정은 이름 바꾸기와 같은 한 함수다.
    let actual = patterns
        .iter()
        .find(|(_, _, t)| t.eq_ignore_ascii_case(target))
        .map(|(_, _, t)| t.clone())
        .expect("찾은 블록에는 대상 패턴이 있다");
    let referrers = jump_referrers(&lines, start..end, &actual);
    if !referrers.is_empty() {
        warnings.push(tr!(
            ko: "경유 호스트로 참조하는 호스트: {list} — 경유 호스트를 다시 고르세요",
            en: "Hosts that use it as a jump host: {list} — pick a new jump host",
            list = referrers.join(", "),
        ));
    }

    if patterns.len() > 1 {
        let idx = patterns
            .iter()
            .position(|(_, _, t)| t.eq_ignore_ascii_case(target))
            .expect("찾은 블록에는 대상 패턴이 있다");
        // 대상 토큰과 인접 공백 하나를 함께 걷어 이중 · 꼬리 공백이 남지 않게 한다(첫 토큰이면 뒤쪽, 아니면 앞쪽).
        let new_value = if idx == 0 {
            format!("{}{}", &d.value[..patterns[0].0], &d.value[patterns[1].0..])
        } else {
            format!(
                "{}{}",
                &d.value[..patterns[idx - 1].1],
                &d.value[patterns[idx].1..]
            )
        };
        let host_line = format!(
            "{}{}{}{}{}",
            d.indent, d.keyword, d.sep, new_value, d.newline
        );
        warnings.push(tr!(
            ko: "이 블록은 별칭 {count}개에 함께 적용됩니다 — 블록은 지우지 않고 Host 줄에서 '{target}' 만 뺐습니다",
            en: "This block applies to {count} aliases — the block was kept and only '{target}' was removed from the Host line",
            count = patterns.len(),
        ));
        let patched = format!(
            "{}{}{}",
            lines[..start].concat(),
            host_line,
            lines[start + 1..].concat()
        );
        return Ok((patched, warnings));
    }

    // 마지막 블록은 앞의 구분 빈 줄([`append_text`] 가 띄운 줄)을 함께 걷는다 — 안 걷으면 추가 → 삭제마다 파일 끝에 빈 줄이 쌓인다.
    let mut start = start;
    if end == lines.len() && start > 0 && lines[start - 1].trim().is_empty() {
        start -= 1;
    }
    let patched = format!("{}{}", lines[..start].concat(), lines[end..].concat());
    Ok((patched, warnings))
}

// ---------------------------------------------------------------------------
// 파일 조작
// ---------------------------------------------------------------------------

pub fn config_path() -> Result<PathBuf, String> {
    dirs::home_dir()
        .map(|home| home.join(".ssh").join("config"))
        .ok_or_else(|| {
            tr!(
                ko: "홈 디렉터리를 찾을 수 없습니다",
                en: "Could not find the home directory"
            )
        })
}

fn ensure_file(path: &Path) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| {
            tr!(
                ko: "{dir} 디렉터리를 만들지 못했습니다: {e}",
                en: "Could not create the directory {dir}: {e}",
                dir = parent.display(),
            )
        })?;
    }
    if !path.exists() {
        std::fs::File::create(path).map_err(|e| {
            tr!(
                ko: "{path} 을(를) 만들지 못했습니다: {e}",
                en: "Could not create {path}: {e}",
                path = path.display(),
            )
        })?;
    }
    Ok(())
}

pub(crate) fn add_host_at(path: &Path, host: &NewHost) -> Result<(), String> {
    let valid = validate(host)?;

    ensure_file(path)?;

    let existing = std::fs::read_to_string(path).map_err(|e| {
        tr!(
            ko: "{path} 읽기 실패: {e}",
            en: "Could not read {path}: {e}",
            path = path.display(),
        )
    })?;

    // 중복 판정은 파서 그대로 · 대소문자 무시(ssh 의 호스트 매칭과 같다).
    if crate::ssh_config::parse(&existing)
        .hosts
        .iter()
        .any(|h| h.name.eq_ignore_ascii_case(&valid.name))
    {
        return Err(tr!(
            ko: "이미 있는 별칭입니다",
            en: "That alias is already in use"
        ));
    }

    let text = append_text(&existing, &valid);

    let mut file = std::fs::OpenOptions::new()
        .append(true)
        .open(path)
        .map_err(|e| {
            tr!(
                ko: "{path} 열기 실패: {e}",
                en: "Could not open {path}: {e}",
                path = path.display(),
            )
        })?;
    file.write_all(text.as_bytes()).map_err(|e| {
        tr!(
            ko: "{path} 쓰기 실패: {e}",
            en: "Could not write {path}: {e}",
            path = path.display(),
        )
    })?;

    Ok(())
}

/// 패치 결과가 원본과 같으면 파일에 손대지 않는다(mtime 이 흔들리지 않게).
pub(crate) fn edit_host_at(path: &Path, host: &EditHost) -> Result<Vec<String>, String> {
    let content = match std::fs::read_to_string(path) {
        Ok(c) => c,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Err(not_found());
        }
        Err(e) => {
            return Err(tr!(
                ko: "{path} 읽기 실패: {e}",
                en: "Could not read {path}: {e}",
                path = path.display(),
            ))
        }
    };

    let (patched, warnings) = patch_block(&content, &host.original_name, host)?;

    if patched != content {
        crate::fs_atomic::replace_through_link(path, patched.as_bytes()).map_err(|e| {
            tr!(
                ko: "{path} 쓰기 실패: {e}",
                en: "Could not write {path}: {e}",
                path = path.display(),
            )
        })?;
    }

    Ok(warnings)
}

/// 삭제 결과가 원본과 같으면 파일에 손대지 않는다.
pub(crate) fn remove_host_at(path: &Path, name: &str) -> Result<Vec<String>, String> {
    let content = match std::fs::read_to_string(path) {
        Ok(c) => c,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Err(not_found());
        }
        Err(e) => {
            return Err(tr!(
                ko: "{path} 읽기 실패: {e}",
                en: "Could not read {path}: {e}",
                path = path.display(),
            ))
        }
    };

    let (patched, warnings) = remove_block(&content, name)?;

    if patched != content {
        crate::fs_atomic::replace_through_link(path, patched.as_bytes()).map_err(|e| {
            tr!(
                ko: "{path} 쓰기 실패: {e}",
                en: "Could not write {path}: {e}",
                path = path.display(),
            )
        })?;
    }

    Ok(warnings)
}

/// `sftp` 의 원격 파일 편집도 같은 폴백을 쓴다 — 열리는 방식이 진입점마다 다르면 안 된다.
#[cfg(windows)]
pub(crate) fn open_with_fallback_editor(path: &Path) -> Result<(), String> {
    std::process::Command::new("notepad")
        .arg(path)
        .spawn()
        .map(|_| ())
        .map_err(|e| tr!(ko: "메모장 실행 실패: {e}", en: "Could not launch Notepad: {e}"))
}

#[cfg(not(windows))]
pub(crate) fn open_with_fallback_editor(_path: &Path) -> Result<(), String> {
    Err(tr!(
        ko: "이 플랫폼에는 폴백 편집기가 없습니다",
        en: "This platform has no fallback editor"
    ))
}

/// 실패는 경고 한 줄 — 이미 끝난 config 수정을 되돌리지 않는다.
pub(crate) fn follow_rename_in_db_conns(conns: Option<&Path>, from: &str, to: &str, warnings: &mut Vec<String>) {
    let (Some(path), from, to) = (conns, from.trim(), to.trim()) else { return };
    if from == to {
        return;
    }
    if let Err(e) = crate::db::conns::rename_via_at(path, from, to) {
        warnings.push(tr!(
            ko: "이 호스트를 경유하는 DB 연결의 경유 이름을 바꾸지 못했습니다 (호스트는 바뀜) — DB 연결을 편집해 경유를 다시 고르세요: {e}",
            en: "Could not update the jump host of the database connections through this host (the host was changed) — edit them and pick the jump host again: {e}"
        ));
    }
}

/// 지운 id 들을 돌려준다(명령이 그 AI 권한을 걷는다). 실패는 경고 한 줄 — 호스트 삭제를 되돌리지 않는다.
pub(crate) fn follow_remove_in_db_conns(conns: Option<&Path>, name: &str, warnings: &mut Vec<String>) -> Vec<String> {
    let Some(path) = conns else { return Vec::new() };
    match crate::db::conns::remove_via_at(path, name) {
        Ok(gone) => gone,
        Err(e) => {
            warnings.push(tr!(
                ko: "이 호스트를 경유하던 DB 연결을 지우지 못했습니다 (호스트는 삭제됨): {e}",
                en: "Could not delete the database connections through this host (the host was deleted): {e}"
            ));
            Vec::new()
        }
    }
}

// ---------------------------------------------------------------------------
// 명령
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn add_host(host: NewHost) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || add_host_at(&config_path()?, &host))
        .await
        .map_err(|e| {
            tr!(
                ko: "호스트를 추가하는 작업이 실패했습니다: {e}",
                en: "The task that adds the host failed: {e}"
            )
        })?
}

#[tauri::command]
pub async fn edit_host(host: EditHost) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut warnings = edit_host_at(&config_path()?, &host)?;
        follow_rename_in_db_conns(crate::db::conns::path().as_deref(), &host.original_name, &host.name, &mut warnings);
        if let Err(e) = crate::delegation::database::follow_via_rename(&host.original_name, &host.name) {
            warnings.push(tr!(
                ko: "이 호스트를 경유하는 DB 연결의 AI 권한을 새 이름으로 옮기지 못했습니다 — DB 연결 폼에서 AI 권한을 다시 고르세요: {e}",
                en: "Could not move the AI permission of the database connections through this host to the new name — pick the AI permission again in the database connection form: {e}"
            ));
        }
        Ok(warnings)
    })
        .await
        .map_err(|e| {
            tr!(
                ko: "호스트를 고치는 작업이 실패했습니다: {e}",
                en: "The task that edits the host failed: {e}"
            )
        })?
}

/// config 먼저 지운다(실패하면 아무것도 지우지 않는다). 메타 · DB 연결 청소는 부가 작업이라 실패해도 config 삭제를 되돌리지 않고 경고로만 알린다.
#[tauri::command]
pub async fn remove_host(name: String) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut warnings = remove_host_at(&config_path()?, &name)?;

        match crate::sessions_meta::sessions_path() {
            Ok(path) => {
                if let Err(e) = crate::sessions_meta::remove_host_meta_at(&path, &name) {
                    warnings.push(tr!(
                        ko: "메타데이터 정리에 실패했습니다 (호스트는 삭제됨): {e}",
                        en: "Could not clean up the metadata (the host was deleted): {e}"
                    ));
                }
            }
            Err(e) => warnings.push(tr!(
                ko: "메타데이터 정리를 건너뜁니다 (호스트는 삭제됨): {e}",
                en: "Skipping the metadata cleanup (the host was deleted): {e}"
            )),
        }
        // 볼트 비밀번호 걷기는 프런트 몫이다(열려 있을 때만).
        let gone = follow_remove_in_db_conns(crate::db::conns::path().as_deref(), &name, &mut warnings);
        // 실패는 무해하다 — 연결이 없으니 끔으로 읽힌다.
        let _ = crate::delegation::database::forget_databases(&gone);
        // 실패는 무해하다(목록에 없는 id 라 독에 서지 않는다). 이벤트는 쏘지 않는다 — 다음 포커스 · 기록 때 맞는다.
        let _ = crate::db_history::forget_ids(&gone);

        Ok(warnings)
    })
    .await
    .map_err(|e| {
        tr!(
            ko: "호스트를 지우는 작업이 실패했습니다: {e}",
            en: "The task that deletes the host failed: {e}"
        )
    })?
}

/// 확장자 없는 파일이라 Windows 에 연결 프로그램이 없을 수 있다 — 그때는 메모장으로 폴백한다.
#[tauri::command]
pub async fn open_ssh_config(app: tauri::AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = config_path()?;
        ensure_file(&path)?;

        match app
            .opener()
            .open_path(path.to_string_lossy().into_owned(), None::<&str>)
        {
            Ok(()) => Ok(()),
            Err(e) => open_with_fallback_editor(&path).map_err(|fallback| {
                tr!(
                    ko: "설정 파일을 열지 못했습니다: {e} ({fallback}) — 직접 {path} 를 여세요",
                    en: "Could not open the config file: {e} ({fallback}) — open {path} yourself",
                    path = path.display(),
                )
            }),
        }
    })
    .await
    .map_err(|e| {
        tr!(
            ko: "설정 파일을 여는 작업이 실패했습니다: {e}",
            en: "The task that opens the config file failed: {e}"
        )
    })?
}

#[cfg(test)]
mod tests;
