//! `~/.ssh/config` 편집 진입점 — 호스트 추가(append) · 호스트 수정(국소 블록 패치) · 설정 파일 열기.
//!
//! ## 파일을 대하는 태도
//!
//! `~/.ssh/config` 는 이 앱의 소유물이 아니다. `ssh`·`scp`·`git`·VS Code Remote-SSH 가
//! 같은 파일을 읽고, 사람이 손으로 쓴 주석·`Include`·`Match`·와일드카드 블록이 들어 있다.
//! 우리 파서([`crate::ssh_config`])는 그중 **일부만** 모델링한다 — 그 부분 모델로 파일을
//! **전체 재작성**하면 우리가 이해하지 못한 줄이 조용히 사라진다. 그래서 전체 재작성은
//! 앞으로도 하지 않는다.
//!
//! 대신 쓰기 범위를 두 가지로만 못 박는다:
//!
//! - **추가** → 파일 **끝에 새 `Host` 블록을 붙이기만** 한다 ([`add_host_at`]).
//!   기존 바이트는 단 한 글자도 건드리지 않는다 (읽기는 중복 별칭 검사용).
//! - **수정** → 대상 별칭의 **`Host` 블록 안쪽만** 국소 패치한다 ([`patch_block`]).
//!   블록 밖(앞뒤 다른 블록·주석·`Include`)은 단 한 바이트도 바뀌지 않는다 — **예외 하나**:
//!   별칭을 바꾸면 다른 블록의 `ProxyJump` 가 방금 사라진 이름을 가리킨 채 남으므로 그
//!   **값의 별칭 자리만** 새 이름으로 따라간다 ([`retarget_jump_line`]).
//!   블록 **안**에서도 우리가 모델링한 7개(별칭·HostName·User·Port·IdentityFile·
//!   IdentitiesOnly·ProxyJump)만 손대고,
//!   나머지 줄(주석·`StrictHostKeyChecking`·`ServerAlive*` …)은 원래 자리에 그대로 둔다.
//! - **삭제**는 아직 GUI 로 만들지 않는다 → [`open_ssh_config`] 로 사용자의 에디터에 넘긴다.
//!
//! ## 구조
//!
//! 파일 IO 와 검증·포매팅을 분리해 둔다. [`validate`]·[`format_block`]·[`append_text`]·
//! [`patch_block`] 은 순수 함수라 파일 없이 단위 테스트할 수 있고, 실제 쓰기는
//! [`add_host_at`]·[`edit_host_at`] 두 곳으로만 모인다.

use std::io::Write;
use std::path::{Path, PathBuf};

use tauri_plugin_opener::OpenerExt;

use crate::i18n::tr;

/// GUI 폼에서 올라오는 새 호스트 입력. 전부 문자열이며 검증 전 raw 값이다.
#[derive(Debug, serde::Deserialize)]
pub struct NewHost {
    pub name: String,
    pub host_name: String,
    pub user: Option<String>,
    pub port: Option<u16>,
    pub identity_file: Option<String>,
    /// `IdentitiesOnly yes` — **위의 키 파일만 내민다** (에이전트 키도, `~/.ssh` 기본 이름도
    /// 빼고). `None`·`Some(false)` 는 둘 다 "그 줄을 적지 않는다" 다 — 꺼짐이 OpenSSH 기본값
    /// 이라 `no` 를 파일에 남길 이유가 없고, `Host *` 에서 물려받은 값은 그대로 둔다
    /// (다른 옵션의 "비우기" 와 같은 규칙).
    #[serde(default)]
    pub identities_only: Option<bool>,
    /// `ProxyJump` — 이 호스트로 가기 전에 먼저 붙을 **경유 호스트** 한 대.
    /// 한 단계만 지원한다 (쉼표 목록은 [`validate`] 가 거절한다 — `ssh.rs` 도 거절하므로
    /// GUI 가 파일에 적을 수 있는 것과 실제로 열 수 있는 것이 어긋나지 않는다).
    pub proxy_jump: Option<String>,
}

/// GUI 수정 폼에서 올라오는 값. `original_name` 은 **블록을 찾는 열쇠**이고,
/// `name` 은 저장할 (바뀔 수도 있는) 새 별칭이다.
#[derive(Debug, serde::Deserialize)]
pub struct EditHost {
    pub original_name: String,
    pub name: String,
    pub host_name: String,
    pub user: Option<String>,
    pub port: Option<u16>,
    pub identity_file: Option<String>,
    /// `IdentitiesOnly`. `None`·`Some(false)` 면 **그 줄을 지운다** ([`NewHost`] 와 같은 규칙).
    #[serde(default)]
    pub identities_only: Option<bool>,
    /// `ProxyJump`. `None` 이면 **그 줄을 지운다** (다른 옵션의 "비우기" 와 같은 규칙).
    pub proxy_jump: Option<String>,
}

impl EditHost {
    /// 검증기를 [`NewHost`] 와 통째로 공유하기 위한 변환 (규칙이 두 벌이 되지 않게).
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

/// [`validate`] 를 통과한 값. 여기서부터는 trim·빈 값 정리가 끝나 있다.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ValidHost {
    name: String,
    host_name: String,
    user: Option<String>,
    port: Option<u16>,
    identity_file: Option<String>,
    /// `true` 일 때만 `IdentitiesOnly yes` 한 줄이 나간다 (거짓은 "줄 없음" 과 같다).
    identities_only: bool,
    proxy_jump: Option<String>,
}

// ---------------------------------------------------------------------------
// 검증 (순수)
// ---------------------------------------------------------------------------

/// 앞뒤 공백을 떼고, 비어 있으면 `None`.
fn clean(v: Option<&String>) -> Option<String> {
    v.map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

/// 한 줄짜리 값에 들어가면 안 되는 문자들.
///
/// - 제어 문자 / 개행 → 블록 구조가 깨진다.
/// - `"` → 파서의 따옴표 토큰화가 어긋난다.
/// - `#` → 그 뒤가 주석으로 잘린다.
///
/// `label` 은 이미 번역된 칸 이름이다 — 부르는 쪽이 [`tr!`] 로 만들어 넘긴다 (두 언어의
/// 어순이 달라서, 문장은 통째로 번역하고 이름만 끼워 넣는 편이 자연스럽다).
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

/// 별칭 검증. 공백·와일드카드(`*` `?` `!`)·따옴표·`=` 를 막는다.
///
/// 와일드카드를 막는 이유: `Host web*` 은 목록에 뜨는 구체 별칭이 아니라 **패턴 블록**이라
/// 사이드바에 나타나지 않는다. 사용자가 "추가했는데 목록에 없다" 를 겪지 않게 입력 단계에서 끊는다.
/// `=` 는 OpenSSH 가 `Host=name` 을 키/값 구분자로 받아들이기 때문에 막는다.
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

/// 폼 입력 전체를 검증한다. 실패 메시지는 그대로 모달에 뿌릴 수 있는 한국어 한 줄.
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

    // 경유 호스트 — 값은 `[user@]host[:port]` 한 덩어리라 공백이 들어갈 자리가 없다.
    // 규칙 셋은 **`ssh.rs` 가 실제로 열 수 있는 것과 같아야** 한다: 한 단계만(쉼표 거절),
    // 자기 자신 금지, 그리고 한 줄짜리 값의 공통 금지 문자.
    let proxy_jump = clean(host.proxy_jump.as_ref());
    if let Some(j) = &proxy_jump {
        if j.chars().any(char::is_whitespace) {
            return Err(tr!(
                ko: "경유 호스트에 공백을 쓸 수 없습니다",
                en: "The jump host cannot contain spaces"
            ));
        }
        reject_unsafe_chars(&tr!(ko: "경유 호스트", en: "The jump host"), j)?;
        // 여러 홉(`ProxyJump a,b`)은 접속 단계가 거절한다 — 저장부터 막아야 "적었는데
        // 안 열리는" 값이 파일에 남지 않는다. 문구는 그쪽과 **같은 한 줄**을 쓴다.
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
        // 검증할 것이 없다 — 값이 `yes` 한 가지뿐이다. 키 파일 없이 켜도 오류가 아니다
        // (OpenSSH 에서도 그때는 기본 이름이 그대로 쓰이고 **에이전트만** 빠진다 —
        // `ssh_config::HostEntry::identities_only` 의 주석). 그 사실은 폼이 말한다.
        identities_only: host.identities_only.unwrap_or(false),
        proxy_jump,
    })
}

// ---------------------------------------------------------------------------
// 포매팅 (순수)
// ---------------------------------------------------------------------------

/// 공백이 있는 값만 따옴표로 감싼다 (파서·OpenSSH 모두 이 형식을 읽는다).
fn quote_if_needed(value: &str) -> String {
    if value.chars().any(char::is_whitespace) {
        format!("\"{value}\"")
    } else {
        value.to_string()
    }
}

/// `Host` 블록 한 덩어리. 항상 개행으로 끝난다. 값이 없는 옵션 줄은 아예 쓰지 않는다.
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

/// 기존 내용 뒤에 **덧붙일 텍스트**를 만든다 (기존 내용 자체는 반환값에 포함되지 않는다).
///
/// 개행 처리:
/// - 빈 파일 → 그대로 블록만.
/// - 끝이 개행이 아님 → 개행 하나로 줄을 닫고, 빈 줄 하나를 띄운다.
/// - 끝이 개행 하나 → 빈 줄 하나를 띄운다.
/// - 이미 빈 줄로 끝남 → 더 띄우지 않는다 (호출할 때마다 빈 줄이 쌓이지 않게).
pub(crate) fn append_text(existing: &str, host: &ValidHost) -> String {
    let prefix = if existing.is_empty() {
        ""
    } else if !existing.ends_with('\n') {
        "\n\n"
    } else if existing.ends_with("\n\n") || existing.ends_with("\n\r\n") {
        ""
    } else {
        "\n"
    };
    format!("{prefix}{}", format_block(host))
}

// ---------------------------------------------------------------------------
// 국소 블록 패치 (순수)
//
// 여기서부터는 파일을 **줄 목록**으로 본다. 각 줄은 자기 개행("\n"/"\r\n"/없음)을 달고
// 있어서, 손대지 않은 줄들을 이어 붙이면 원본 바이트가 그대로 복원된다. 패치는 대상
// 블록 구간 [start, end) 안에서만 일어나고, 바깥은 슬라이스째 그대로 이어 붙인다.
// ---------------------------------------------------------------------------

/// 우리가 수정 대상으로 삼는 블록 안 옵션. 출력 순서(새로 추가할 때)도 이 순서다.
const EDITABLE: [&str; 6] = [
    "hostname",
    "user",
    "port",
    "identityfile",
    // `IdentityFile` 바로 뒤다 — 그 줄을 좁히는 옵션이라 파일에서도 붙어 읽힌다
    // (폼에서도 두 줄이 붙어 있다).
    "identitiesonly",
    "proxyjump",
];

/// 개행을 **보존**하며 줄 단위로 자른다. `concat()` 하면 원본과 바이트가 같다.
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

/// 한 줄을 다시 조립할 수 있는 조각으로 쪼갠 것.
/// `indent + keyword + sep + value + newline` 을 그대로 이으면 원래 줄이 된다.
struct Directive<'a> {
    indent: &'a str,
    keyword: &'a str,
    /// 키워드와 값 사이의 구분자 — `" "`, `"="`, `" = "` 를 **원문 그대로** 담는다.
    sep: &'a str,
    /// 값 영역 (줄 끝 주석·뒤 공백까지 포함).
    value: &'a str,
    newline: &'a str,
}

/// 빈 줄·주석 줄이면 `None`. 그 외에는 조각으로 쪼갠다.
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

/// 값 영역의 토큰들을 `(시작, 끝, 따옴표 벗긴 내용)` 으로 돌려준다.
/// 파서([`crate::ssh_config`])의 `tokenize` 와 같은 규칙이되 **위치**를 함께 준다.
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

/// `Host` 줄의 패턴 목록 (줄 끝 주석 앞까지).
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

/// 옵션 줄의 값을 `replacement` 로 갈아 끼운다. 들여쓰기·구분자·줄 끝 주석은 그대로 둔다.
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
// 다른 블록의 `ProxyJump` — 같은 파일 안의 다섯째 자리
//
// 별칭은 자기 블록의 `Host` 줄에만 있는 것이 아니다. **다른 블록의 `ProxyJump`** 가 같은
// 글자로 이 호스트를 가리킨다. 이름만 바꾸고 말면 그 줄들은 없는 이름을 가리킨 채 남고,
// 그 호스트들은 **경유 단계에서** 실패한다 (사용자 보고: `Remote-SSH` → `SSH`).
// 앱 쪽 자리(즐겨찾기·스니펫·레이아웃·탭)는 프런트가 따라가지만
// (docs/log/2026-09-17-host-rename-fanout.md), 이 자리는 **같은 파일 안**이라 여기서 따라간다.
//
// 판정은 **정확히 일치**다. `ProxyJump` 값은 `[user@]별칭[:포트]` 한 덩어리(쉼표로 여럿)라
// 별칭 자리만 떼어 글자째 비교하고, 맞은 자리만 갈아 끼운다 — `Remote-SSH2` 는 걸리지 않고
// `user@`·`:port` 는 그대로 딸려 간다. 대소문자를 접지 않는 이유: 이름만 대소문자가 바뀐
// 경우 옛 글자도 OpenSSH 가 여전히 같은 호스트로 읽으므로(호스트 매칭은 대소문자 무시)
// 고치지 않아도 깨지지 않는다 — 안 고쳐서 손해가 없는 쪽이 파일을 덜 건드린다.
// ---------------------------------------------------------------------------

/// `[user@]호스트[:포트]` 한 덩어리에서 **호스트 자리**의 구간 `(시작, 끝)`.
///
/// 포트로 보는 것은 **마지막 `:` 뒤가 전부 숫자일 때**뿐이다 (그래야 `[::1]` 같은 글자를
/// 반으로 자르지 않는다).
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

/// 홉 한 덩어리가 이 별칭을 가리키는가. 이름 바꾸기와 지우기가 **같은 한 판정**을 쓴다.
fn hop_targets(hop: &str, alias: &str) -> bool {
    let (s, e) = hop_alias_span(hop);
    &hop[s..e] == alias
}

/// `ProxyJump` 값(쉼표 목록 포함)에서 `from` 을 가리키는 홉의 **별칭 자리만** `to` 로 바꾼다.
/// 바꿀 것이 없으면 `None` (= 그 줄은 손대지 않는다).
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

/// 한 줄이 `from` 을 가리키는 `ProxyJump` 줄이면 고쳐 쓴 줄을, 아니면 `None`.
/// 들여쓰기·`=` 표기·줄 끝 주석은 [`replace_first_value`] 가 그대로 지킨다.
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

/// 줄 묶음을 이어 붙이되 `from` 을 가리키는 `ProxyJump` 줄만 고친다 — (결과, 고친 줄 수).
/// 고치지 않은 줄은 슬라이스째 그대로라 바깥 바이트는 변하지 않는다.
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

/// `alias` 를 `ProxyJump` 로 가리키는 **다른 `Host` 블록**의 이름들 (등장 순서, 중복 없음).
///
/// `skip` 구간(= 지워질 블록)은 건너뛴다. 줄을 **그대로** 읽는다 — 파서의 병합값을 쓰면
/// `Host *` 에서 값을 물려받았을 뿐인 호스트까지 딸려 온다.
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

/// 대상 별칭을 찾지 못했을 때의 문구. 고치기·지우기 네 자리가 **같은 한 줄**을 쓴다
/// (예전의 `const NOT_FOUND` 자리 — 번역은 실행 시점에 정해지므로 상수가 될 수 없다).
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
        // 꺼짐은 `no` 가 아니라 **줄 없음**이다 — 꺼짐이 OpenSSH 기본값이라 `no` 를 남기면
        // 파일에 뜻 없는 줄이 쌓이고, `Host *` 에서 물려받던 값을 여기서 끊어 버린다.
        "identitiesonly" => host.identities_only.then(|| "yes".to_string()),
        // 공백을 막아 뒀으므로 따옴표를 씌울 일이 없다 (씌우면 OpenSSH 도 우리 파서도
        // 읽기는 하지만, 사람이 손으로 적은 줄과 모양이 달라진다).
        "proxyjump" => host.proxy_jump.clone(),
        _ => None,
    }
}

/// `original_name` 의 `Host` 블록만 국소 패치한 **파일 전체**와 경고들을 돌려준다.
///
/// 보장:
/// - 블록 구간 밖은 바이트 단위로 동일하다.
/// - 블록 안에서도 [`EDITABLE`] 5개 옵션 줄과 `Host` 줄의 해당 패턴 토큰만 바뀐다.
///   그 외(주석·미지원 옵션)는 위치까지 그대로 남는다.
/// - 같은 별칭의 블록이 여럿이면 **첫 블록만** 고치고 경고를 붙인다.
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

    // 별칭을 바꾸는 경우에만 중복 검사 (자기 자신과 같은 이름은 당연히 허용).
    // 판정 기준은 add_host 와 같은 파서다 — 목록에 보이는 이름과 어긋나지 않는다.
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

    // 1) 대상 Host 줄 찾기 (+ 같은 별칭의 다른 블록 세기)
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

    // 2) 블록 끝 = 다음 Host/Match 줄 직전 (없으면 EOF)
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

    // 3) Host 줄 — 별칭이 바뀔 때만, 해당 패턴 토큰 하나만 갈아 끼운다.
    //    (바뀌었다면 **파일에 적힌 옛 글자**를 들고 나간다 — 블록 찾기는 대소문자를 무시하므로
    //     `original` 과 파일의 글자가 다를 수 있고, `ProxyJump` 따라가기는 글자째 비교한다.)
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

    // 4) 블록 본문 — 지원 옵션은 값 교체/삭제, 그 외 줄은 바이트 그대로.
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
            out.push((*raw).to_string()); // 미지원 옵션 — 손대지 않는다
            continue;
        };

        // 같은 옵션이 블록에 두 번 나오면 첫 줄만 남긴다 (뒷줄을 남기면 first-wins 로
        // 우리가 쓴 값이 되살아난 옛 값에 가려질 수 있다).
        if handled.contains(slot) {
            continue;
        }
        handled.push(*slot);
        match desired_value(&key, &valid) {
            Some(v) => out.push(replace_first_value(&d, &v)),
            None => continue, // 폼에서 비운 옵션 → 줄 삭제
        }
    }

    // 5) 블록에 없던 옵션은 블록 끝(보존 줄들 뒤, 꼬리 빈 줄 앞)에 추가한다.
    let missing: Vec<&str> = EDITABLE
        .iter()
        .copied()
        .filter(|k| !handled.contains(k) && desired_value(k, &valid).is_some())
        .collect();

    if !missing.is_empty() {
        // 들여쓰기·개행은 **그 블록의 관례**를 따른다. 블록에 옵션 줄이 하나도 없으면
        // append 와 같은 기본값(공백 4칸)과 파일 전체의 개행 스타일로 떨어진다.
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
        // 파일이 개행 없이 끝났다면 먼저 줄을 닫는다.
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

    // 6) 이름이 바뀌었으면 **블록 밖의 `ProxyJump`** 도 새 이름으로 따라간다.
    //    이 걸음만이 블록 바깥 바이트를 건드리는 유일한 예외다 — 그 줄들은 방금 사라진
    //    이름을 가리키고 있고, 두면 그 호스트들이 경유 단계에서 실패한다.
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

/// `name` 별칭의 `Host` 블록을 통째로 들어낸 **파일 전체**와 경고들을 돌려준다.
///
/// 국소 삭제 — 대상 블록 구간 `[start, end)` 만 빠지고 바깥(앞뒤 블록·주석·빈 줄·개행)은
/// 바이트 단위로 그대로다. 블록 끝은 [`patch_block`] 과 같은 규칙(다음 `Host`/`Match` 줄 직전
/// 또는 EOF). 블록 **바로 위**에 사람이 적은 주석·빈 줄은 블록 밖이라 손대지 않는다.
///
/// **여러 별칭을 공유하는 `Host` 줄**(`Host web db`)은 블록을 지우지 않는다 — 그러면 다른
/// 별칭까지 함께 사라진다. `Host` 줄에서 대상 별칭 토큰 하나만 빼고 블록은 남긴 뒤 경고한다.
/// 대상 별칭을 찾지 못하면 [`edit_host`] 와 같은 한국어 오류를 돌려준다.
///
/// 같은 별칭 블록이 여럿이면 [`patch_block`] 처럼 **첫 블록만** 지우고 경고를 붙인다.
pub(crate) fn remove_block(content: &str, name: &str) -> Result<(String, Vec<String>), String> {
    let target = name.trim();
    if target.is_empty() {
        return Err(not_found());
    }

    let lines = split_lines_keep(content);

    // 1) 대상 Host 줄 찾기 (+ 같은 별칭의 다른 블록 세기) — 판정기는 patch_block 과 동일.
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

    // 2) 블록 끝 = 다음 Host/Match 줄 직전 (없으면 EOF).
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

    // 3) 여러 별칭을 공유하는 Host 줄이면 블록을 남기고 대상 토큰만 뺀다.
    let d = parse_directive(lines[start]).expect("Host 줄은 지시어다");
    let patterns = host_patterns(d.value);

    // 이 별칭을 `ProxyJump` 로 가리키던 호스트들은 지금 **경유를 잃는다**. 여기서 고칠 수
    // 있는 값이 없으므로(무엇으로 바꿀지는 사람만 안다) 말없이 두지 않고 이름을 대 준다.
    // 판정은 이름 바꾸기와 같은 한 함수다 — 두 자리가 다른 답을 내면 안 된다.
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
        // 대상 토큰과 인접 공백 하나를 함께 걷어내 이중 공백·꼬리 공백이 남지 않게 한다:
        // 첫 토큰이면 뒤쪽 공백을, 아니면 앞쪽 공백을 흡수한다 (줄 끝 주석은 그대로 딸려 온다).
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

    // 4) 단일 패턴 — 블록 [start, end) 를 통째로 들어낸다. 바깥은 슬라이스째 그대로 이어 붙인다.
    //
    // 가운데 블록은 제 뒤 빈 줄(다음 블록과의 구분)까지 함께 빠진다. **마지막 블록**은 뒤에 빈
    // 줄이 없고 구분 빈 줄이 **앞**에 있다 — [`append_text`] 가 붙일 때 띄운 바로 그 줄이다.
    // 그 빈 줄 하나를 함께 걷어야 추가 → 삭제가 원본으로 돌아간다(안 걷으면 파일 끝에 빈 줄이
    // 하나씩 쌓인다). 주석은 빈 줄이 아니라 그대로다.
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

/// `~/.ssh/config` 경로. 파일이 있는지는 보지 않는다.
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

/// `~/.ssh` 디렉터리와 `config` 파일이 없으면 만든다 (파일은 빈 채로).
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

/// 지정한 경로의 ssh config 끝에 새 `Host` 블록을 붙인다. 기존 내용은 읽기만 한다.
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

    // 중복 별칭 검사는 파서를 그대로 재사용한다 — 목록에 보이는 이름과 판정 기준이 어긋나지 않는다.
    // (ssh 의 호스트 매칭이 대소문자를 무시하므로 여기서도 무시한다.)
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

/// 지정한 경로의 ssh config 에서 **한 `Host` 블록만** 고쳐 쓴다.
///
/// 패치 결과가 원본과 같으면 파일에 손도 대지 않는다 (수정 없이 저장을 눌러도 mtime 이
/// 흔들리지 않는다). 반환값은 사용자에게 보여줄 경고 목록.
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

/// 지정한 경로의 ssh config 에서 **한 `Host` 블록만** 들어낸다 (또는 공용 줄에서 별칭만 뺀다).
///
/// 삭제 결과가 원본과 같으면(공용 줄 무변화 등) 파일에 손도 대지 않는다. 파일·호스트가 없으면
/// [`edit_host_at`] 과 같은 한국어 오류. 반환값은 사용자에게 보여줄 경고 목록.
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

/// Windows 에서 연결 프로그램이 없을 때의 폴백 — 메모장으로 연다.
/// (`sftp` 모듈의 원격 파일 편집도 같은 규칙을 쓴다 — 열리는 방식이 진입점마다 다르면 안 된다.)
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

/// 별칭 변경을 DB 연결 목록의 `via` 에 따라 적는다 — 실패는 경고 한 줄(이미 끝난 config 수정을 되돌리지 않는다 · 메타 청소와 같은
/// 무게). `conns` 가 `None`(설정 폴더를 모름)이면 그 목록이 있을 수 없으니 지나간다. 별칭이 같으면 아무것도 하지 않는다.
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

/// 호스트 삭제를 DB 연결 목록에 따라 적는다 — 그 호스트를 경유하던 줄을 지우고 **지운 id 들**을 돌려준다(명령이 그 AI 권한을 걷는다).
/// 실패는 경고 한 줄(호스트 삭제를 되돌리지 않는다).
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
//
// 넷 다 **`async` + `spawn_blocking`** 이다 — 셋은 `~/.ssh/config` 를 읽고-고쳐-쓰고
// (`remove_host` 는 `sessions.toml` 까지, `edit_host`·`remove_host` 는 DB 연결 목록
// `db-connections.json` 의 경유까지 만진다), 하나는 아예 **외부 프로그램을 띄운다**
// ([`open_ssh_config`]). 동기 명령은 웹뷰 UI 스레드에서 그대로 도는데, 그 사이 살아 있는
// 터미널의 출력 채널이 막히면 그 터미널은 영구히 침묵한다
// (docs/log/2026-09-05-async-commands.md · docs/conventions.md).
// ---------------------------------------------------------------------------

/// 새 호스트를 `~/.ssh/config` **끝에 추가**한다. 기존 내용은 재작성하지 않는다.
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

/// 기존 호스트의 `Host` 블록 **안쪽만** 고친다. 블록 밖은 한 바이트도 바뀌지 않는다.
///
/// 반환값은 경고 목록(빈 배열이면 조용히 성공). 실패는 폼에 그대로 띄울 한국어 한 줄.
#[tauri::command]
pub async fn edit_host(host: EditHost) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut warnings = edit_host_at(&config_path()?, &host)?;
        // 별칭이 바뀌었으면 그 호스트를 경유하던 DB 연결(`db-connections.json` 의 `via`)도 새 이름으로 — 같은 명령 안에서.
        follow_rename_in_db_conns(crate::db::conns::path().as_deref(), &host.original_name, &host.name, &mut warnings);
        // AI 권한(쿼리 타일 3a — `delegation.toml` `[[database]]`)의 경유 이름도 — 같은 서버다(별칭이 가리키는 곳은 스냅샷이 따로 쥔다).
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

/// 호스트를 **양쪽 파일에서** 지운다: `~/.ssh/config` 의 `Host` 블록과 `~/.ssh/sessions.toml`
/// 의 `[hosts.<별칭>]` 메타 테이블. 둘 다 국소 편집이라 나머지 블록·테이블·주석은 그대로다.
///
/// 순서는 config 먼저(실패하면 아무것도 지우지 않고 오류). 그다음 메타 청소는 **부가 작업**이라
/// 실패해도 이미 끝난 config 삭제를 되돌리지 않고 경고로만 알린다 (메타는 없어도 정상이다).
/// 그 호스트를 경유하던 DB 연결(`db-connections.json`)도 같은 무게로 지운다([`follow_remove_in_db_conns`]).
/// 반환값은 두 단계의 경고를 합친 것 — 공용 줄에서 별칭만 뺐다거나, 메타 청소가 어긋났다는 등.
#[tauri::command]
pub async fn remove_host(name: String) -> Result<Vec<String>, String> {
    // 두 파일을 잇달아 만지므로 **한 덩어리로** 블로킹 풀에 넣는다 (중간에 UI 스레드로
    // 돌아왔다 다시 나가 봐야 얻는 것이 없다).
    tauri::async_runtime::spawn_blocking(move || {
        let mut warnings = remove_host_at(&config_path()?, &name)?;

        // 메타는 앱 소유라 없거나 비어 있는 것이 정상 — 청소는 조용한 no-op 이 기본이고, 실제
        // 오류(깨진 TOML 등)조차 호스트 삭제 자체를 실패로 만들지 않고 경고로만 올린다.
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
        // 그 호스트를 경유하던 DB 연결도 지운다(삭제 확인이 개수를 밝혔다 — 볼트 비밀번호 걷기는 프런트, 열려 있을 때만).
        let gone = follow_remove_in_db_conns(crate::db::conns::path().as_deref(), &name, &mut warnings);
        // 지운 연결의 AI 권한도 걷는다(쿼리 타일 3a). 실패는 무해하다 — 연결이 없으니 끔으로 읽힌다(설정 › 보안 표에 고아로 보인다).
        let _ = crate::delegation::database::forget_databases(&gone);
        // 접속 기록(`db-history.json`)의 그 줄들도 — 실패는 무해하다(목록에 없는 id 라 독에 서지 않는다). 이벤트는 쏘지 않는다:
        // 남은 사본의 줄도 같은 까닭으로 보이지 않고, 다음 포커스 · 다음 기록 때 맞는다.
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

/// `~/.ssh/config` 를 기본 프로그램으로 연다 (없으면 빈 파일로 만들고 연다).
///
/// 확장자가 없는 파일이라 Windows 에 연결 프로그램이 없을 수 있다 — 그때는 메모장으로 폴백한다.
///
/// **가장 느릴 수 있는 명령이다** — 파일을 만들고(`ensure_file`) 셸 연결 프로그램을 찾아
/// **프로세스를 띄운다**. 실패하면 메모장까지 한 번 더 띄운다. 전부 블로킹 풀에서.
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
